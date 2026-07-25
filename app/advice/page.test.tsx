import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ADVICE_CONSENT_VERSION, grantAdviceConsent } from '@/lib/adviceConsent';
import { ADVICE_CONSENT_HEADER } from '@/lib/consentGate';
import type { AdviceResult } from '@/lib/adviceGuard';
import { MAX_ADVICE_QUESTION_CHARS } from '@/lib/adviceSchema';
import { LANG_PREFERENCE_KEY } from '@/lib/langPreference';
// PRESERVED RESEARCH: Feature 2 was quarantined 2026-07-25 (see app/advice/page.tsx). The portal
// implementation now lives in AdvicePageResearch.tsx and is no longer routable; these tests keep
// exercising it so the T1-T4 work stays verified on the branch. The proof that /advice itself is
// unreachable lives in app/advice/quarantine.test.tsx.
import AdvicePage from './AdvicePageResearch';

const NORMAL_RESULT = {
  presentation: 'normal',
  banners: [],
  refused: null,
  schools: {
    tcm: {
      suggestions: ['TCM general suggestion'],
      seekCare: 'TCM seek-care guidance',
    },
    tibetan: {
      suggestions: ['Tibetan-medicine general suggestion'],
      seekCare: 'Tibetan-medicine seek-care guidance',
    },
    western: {
      suggestions: ['Western general suggestion'],
      seekCare: 'Western seek-care guidance',
    },
  },
} as const satisfies AdviceResult;

const BLOCKED_DOSING_RESULT = {
  presentation: 'blocked',
  banners: [],
  refused: 'dosing',
} as const satisfies AdviceResult;

function resultResponse(result: AdviceResult): Response {
  return Response.json({ data: result });
}

function nonOkResponse(status: number): {
  response: Response;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn(() => {
    throw new Error('non-2xx response bodies must not be read');
  });
  return {
    response: {
      ok: false,
      status,
      json,
    } as unknown as Response,
    json,
  };
}

function fillQuestion(value = 'How can I sleep better?'): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your health question' }), {
    target: { value },
  });
}

function submitQuestion(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Ask my question' }));
}

function assertFrame(): void {
  expect(screen.getAllByTestId('advice-disclaimer')).toHaveLength(5);
  expect(screen.getByTestId('advice-referral')).toHaveTextContent(
    'These are general suggestions to bring to a professional — not a diagnosis or treatment plan for you.',
  );
}

describe('advice page T4 live flow', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the privacy-minimizing form and the fixed safety frame', () => {
    render(<AdvicePage />);

    const gender = screen.getByRole('combobox', { name: 'Gender' });
    const age = screen.getByRole('combobox', { name: 'Age' });
    expect(gender).toHaveValue('unknown');
    expect(age).toHaveValue('');
    expect(screen.getAllByRole('option', { name: 'Prefer not to say · 不便透露' })).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Female · 女' })).toHaveValue('female');
    expect(screen.getByRole('option', { name: 'Male · 男' })).toHaveValue('male');
    expect(screen.getByRole('option', { name: 'Under 18 · 18 岁以下' })).toHaveValue('10');
    expect(screen.getByRole('option', { name: '18–64 · 18–64 岁' })).toHaveValue('40');
    expect(screen.getByRole('option', { name: '65 and over · 65 岁及以上' })).toHaveValue('70');

    const question = screen.getByRole('textbox', { name: 'Your health question' });
    expect(question).toBeRequired();
    expect(screen.getByText('0 / 2000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask my question' })).toBeDisabled();

    expect(screen.getAllByTestId('advice-disclaimer')).toHaveLength(5);
    expect(screen.getByTestId('advice-referral')).toHaveTextContent(
      'These are general suggestions to bring to a professional — not a diagnosis or treatment plan for you.',
    );
  });

  it('locks the local client limit to the server schema limit without bundling Zod into the page', () => {
    expect(MAX_ADVICE_QUESTION_CHARS).toBe(2000);
    render(<AdvicePage />);
    expect(
      screen.getByText(`0 / ${MAX_ADVICE_QUESTION_CHARS}`),
    ).toBeInTheDocument();
  });

  it('gates the first submit and sends the exact live request only after consent', async () => {
    let resolveFetch!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<AdvicePage />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Gender' }), {
      target: { value: 'female' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Age' }), {
      target: { value: '40' },
    });
    fillQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'Chinese' }));
    submitQuestion();

    const dialog = screen.getByRole('dialog', { name: 'Before you ask' });
    expect(dialog).toHaveTextContent(
      "This page gives health suggestions written by an AI (Anthropic's Claude)",
    );
    expect(dialog).toHaveTextContent(
      'Your question — including any health details you type in it — is sent to Anthropic',
    );
    expect(dialog).toHaveTextContent(
      "In an emergency, don't ask here — call 120 (mainland China)",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    assertFrame();

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'I understand — ask my question',
      }),
    );

    expect(screen.getByText('Preparing your answer')).toBeInTheDocument();
    assertFrame();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/advice');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      [ADVICE_CONSENT_HEADER]: String(ADVICE_CONSENT_VERSION),
    });
    expect(JSON.parse(String(init.body))).toEqual({
      gender: 'female',
      age: 40,
      question: 'How can I sleep better?',
      languageMode: 'zh',
    });

    await act(async () => resolveFetch(resultResponse(NORMAL_RESULT)));
    expect(await screen.findByText('TCM general suggestion')).toBeInTheDocument();
    assertFrame();
  });

  it('omits age from the request when the user does not provide an age band', async () => {
    grantAdviceConsent();
    fetchMock.mockResolvedValueOnce(resultResponse(NORMAL_RESULT));
    render(<AdvicePage />);

    fillQuestion('A question without an age band');
    submitQuestion();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      gender: 'unknown',
      question: 'A question without an age band',
      languageMode: 'en',
    });
  });

  it('keeps the safety frame present before, during, and after a blocked live response', async () => {
    grantAdviceConsent();
    let resolveFetch!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<AdvicePage />);

    assertFrame();
    fillQuestion('A question');
    submitQuestion();
    expect(screen.getByText('Preparing your answer')).toBeInTheDocument();
    assertFrame();

    await act(async () => resolveFetch(resultResponse(BLOCKED_DOSING_RESULT)));
    expect(await screen.findByTestId('advice-refusal')).toHaveTextContent(
      "We can't show this answer because it included specific medication or remedy amounts",
    );
    expect(screen.queryByTestId('advice-schools')).not.toBeInTheDocument();
    expect(screen.queryByText('Chinese Medicine')).not.toBeInTheDocument();
    assertFrame();
  });

  it('returns a 403 response to the consent phase without reading its body', async () => {
    grantAdviceConsent();
    const { response, json } = nonOkResponse(403);
    fetchMock.mockResolvedValueOnce(response);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<AdvicePage />);
      fillQuestion();
      submitQuestion();

      expect(
        await screen.findByRole('dialog', { name: 'Before you ask' }),
      ).toBeInTheDocument();
      expect(json).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('advice request failed', {
        status: 403,
        cause: 'consent',
      });
      assertFrame();

      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Before you ask' })).getByRole(
          'button',
          { name: 'Back' },
        ),
      );
      expect(screen.getByRole('textbox', { name: 'Your health question' })).toHaveValue(
        'How can I sleep better?',
      );
      submitQuestion();
      expect(screen.getByRole('dialog', { name: 'Before you ask' })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders wrapper banner IDs through hard-coded copy before fixed-order school cards', async () => {
    grantAdviceConsent();
    const bannerResult = {
      ...NORMAL_RESULT,
      presentation: 'banner',
      banners: ['emergency'],
      bannerText: 'MODEL-PROVIDED BANNER TEXT MUST NEVER RENDER',
    } as const;
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: bannerResult }),
    );
    render(<AdvicePage />);

    fillQuestion('I have chest pain');
    submitQuestion();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(
      'If this is happening to you or someone near you right now, get emergency help immediately',
    );
    expect(banner).not.toHaveTextContent('MODEL-PROVIDED BANNER TEXT MUST NEVER RENDER');
    const schoolCards = screen
      .getByTestId('advice-schools')
      .querySelectorAll<HTMLElement>('[data-school]');
    expect([...schoolCards].map((card) => card.dataset.school)).toEqual([
      'tcm',
      'tibetan',
      'western',
    ]);
    assertFrame();
  });

  it('renders the hard-coded see-doctor banner copy', async () => {
    grantAdviceConsent();
    fetchMock.mockResolvedValueOnce(
      resultResponse({
        ...NORMAL_RESULT,
        presentation: 'banner',
        banners: ['see-doctor'],
      }),
    );
    render(<AdvicePage />);

    fillQuestion();
    submitQuestion();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please discuss this question with a doctor or another qualified health professional',
    );
    assertFrame();
  });

  it('keeps the answer language snapshot when the UI language changes during a request', async () => {
    grantAdviceConsent();
    let resolveFetch!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<AdvicePage />);

    fillQuestion();
    submitQuestion();
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    await act(async () => resolveFetch(resultResponse(NORMAL_RESULT)));

    expect(await screen.findByText('TCM general suggestion')).toHaveAttribute(
      'lang',
      'en',
    );
    expect(screen.getByTestId('advice-referral')).toHaveTextContent(
      '以上只是供您与专业人员讨论的一般性建议',
    );
  });

  it('renders an emergency-only block as banner-only with no refusal or schools', async () => {
    grantAdviceConsent();
    fetchMock.mockResolvedValueOnce(
      resultResponse({
        presentation: 'blocked',
        banners: ['emergency-self-harm'],
        refused: 'emergency-only',
      }),
    );
    render(<AdvicePage />);

    fillQuestion('A suppress-model question');
    submitQuestion();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You deserve support right now.',
    );
    expect(screen.queryByTestId('advice-refusal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('advice-schools')).not.toBeInTheDocument();
    assertFrame();
  });

  it.each([
    [
      'tibetan-output',
      "We can't show this answer because it contained Tibetan-language text",
    ],
    [
      'out-of-scope',
      "We can't answer this here because this page is only for personal health questions",
    ],
  ] as const)(
    'keeps the frame and suppresses schools for a %s refusal',
    async (refused, expectedCopy) => {
      grantAdviceConsent();
      fetchMock.mockResolvedValueOnce(
        resultResponse({
          presentation: 'blocked',
          banners: [],
          refused,
        }),
      );
      render(<AdvicePage />);

      fillQuestion();
      submitQuestion();

      expect(await screen.findByTestId('advice-refusal')).toHaveTextContent(
        expectedCopy,
      );
      expect(screen.queryByTestId('advice-schools')).not.toBeInTheDocument();
      assertFrame();
    },
  );

  it.each([
    [429, 'Too many questions have been sent from this network.', 'rate-limited'],
    [413, 'This question is too long.', 'too-long'],
    [422, "We couldn't prepare an answer.", 'could-not-answer'],
    [502, 'The answer service is temporarily unavailable.', 'unavailable'],
  ] as const)(
    'maps status %i to honest client copy without reading the response body',
    async (status, expectedCopy, cause) => {
      grantAdviceConsent();
      const { response, json } = nonOkResponse(status);
      fetchMock.mockResolvedValueOnce(response);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        render(<AdvicePage />);
        fillQuestion();
        submitQuestion();

        expect(await screen.findByRole('alert')).toHaveTextContent(expectedCopy);
        expect(json).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith('advice request failed', {
          status,
          cause,
        });
        assertFrame();
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it('maps a fetch rejection to unavailable without logging the caught error', async () => {
    grantAdviceConsent();
    const privateError = new Error('private question and network internals');
    fetchMock.mockRejectedValueOnce(privateError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<AdvicePage />);
      fillQuestion();
      submitQuestion();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The answer service is temporarily unavailable.',
      );
      expect(consoleError).toHaveBeenCalledWith('advice request failed', {
        status: null,
        cause: 'unavailable',
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateError.message);
      assertFrame();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('fails a malformed successful payload closed instead of dropping an unknown banner ID', async () => {
    grantAdviceConsent();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          ...NORMAL_RESULT,
          presentation: 'banner',
          banners: ['model-invented-banner'],
        },
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<AdvicePage />);
      fillQuestion();
      submitQuestion();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "We couldn't prepare an answer.",
      );
      expect(consoleError).toHaveBeenCalledWith('advice request failed', {
        status: 200,
        cause: 'could-not-answer',
      });
      assertFrame();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('fails contradictory refused-plus-schools payloads closed without rendering model prose', async () => {
    grantAdviceConsent();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          ...NORMAL_RESULT,
          refused: 'dosing',
        },
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<AdvicePage />);
      fillQuestion();
      submitQuestion();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "We couldn't prepare an answer.",
      );
      expect(screen.queryByText('TCM general suggestion')).not.toBeInTheDocument();
      expect(screen.queryByTestId('advice-schools')).not.toBeInTheDocument();
      expect(consoleError).toHaveBeenCalledWith('advice request failed', {
        status: 200,
        cause: 'could-not-answer',
      });
      assertFrame();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('shows the Tibetan-language limitation and defaults generated-answer language to Chinese', async () => {
    localStorage.setItem(LANG_PREFERENCE_KEY, 'bo');
    render(<AdvicePage />);

    const notice = await screen.findByTestId('advice-tibetan-availability');
    expect(notice).toHaveTextContent('目前回答仅提供中文和英文，默认选择中文。');

    const answerLanguage = screen.getByRole('group', { name: '回答语言' });
    await waitFor(() => {
      expect(within(answerLanguage).getByRole('button', { name: '中文' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(document.querySelector('input[name="language_mode"]')).toHaveValue('zh');
  });

  it('marks the Tibetan consent dialog as a Chinese fallback and still makes no request', async () => {
    localStorage.setItem(LANG_PREFERENCE_KEY, 'bo');
    render(<AdvicePage />);
    await screen.findByTestId('advice-tibetan-availability');

    fireEvent.change(screen.getByRole('textbox', { name: '您的健康问题' }), {
      target: { value: 'A question' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交问题' }));

    const dialog = screen.getByRole('dialog', { name: '在提问之前' });
    expect(dialog).toHaveAttribute('data-requested-lang', 'bo');
    expect(dialog).toHaveAttribute('data-resolved-lang', 'zh');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('advice-disclaimer')).toHaveLength(5);
    expect(screen.getByTestId('advice-referral')).toHaveTextContent(
      '以上只是供您与专业人员讨论的一般性建议，不是针对您个人的诊断或治疗方案。',
    );
  });
});
