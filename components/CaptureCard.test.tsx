import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Lang } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  downscaleToJpeg: vi.fn<(file: File) => Promise<Blob>>(),
  hasConsent: vi.fn<() => boolean>(),
  grantConsent: vi.fn<() => void>(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/lib/downscaleImage', () => ({
  downscaleToJpeg: mocks.downscaleToJpeg,
}));

vi.mock('@/lib/consent', () => ({
  hasConsent: mocks.hasConsent,
  grantConsent: mocks.grantConsent,
  CONSENT_VERSION: 2,
}));

import { CaptureCard } from './CaptureCard';

const NativeURL = globalThis.URL;
let consoleError: ReturnType<typeof vi.spyOn>;

function failedResponse(status: number, error: string) {
  const json = vi.fn().mockResolvedValue({ error });
  return {
    json,
    response: { ok: false, status, json } as unknown as Response,
  };
}

function successfulResponse(payload: unknown) {
  const json = vi.fn().mockResolvedValue(payload);
  return {
    json,
    response: { ok: true, status: 200, json } as unknown as Response,
  };
}

async function uploadAndSubmit(lang: Lang = 'en') {
  const user = userEvent.setup();
  const { container } = render(<CaptureCard lang={lang} />);
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Capture file input not found');

  const file = new File(['image bytes'], 'lab.jpg', { type: 'image/jpeg' });
  await user.upload(input, file);
  await user.click(screen.getByRole('button', { name: /Use this photo/i }));
  return { file, user };
}

function expectUnreadablePresentation(alert: HTMLElement) {
  expect(alert).toHaveTextContent(
    'We couldn’t read enough text from this photo. Retake it with the report clear and flat.',
  );
  expect(alert).toHaveTextContent(
    '我们无法从这张照片中清楚读取足够的文字。请将报告放平、拍清楚后重试。',
  );
  expect(
    within(alert).getByRole('button', { name: 'Retake · 重拍' }),
  ).toBeInTheDocument();
}

function consentRenderContract(dialog: HTMLElement) {
  const bilingual = (node: Element | null) => {
    if (!(node instanceof HTMLElement)) throw new Error('Consent copy node not found');
    const [english, chinese] = [...node.childNodes];
    return {
      childNodes: node.childNodes.length,
      en: english?.textContent,
      zh:
        chinese instanceof HTMLElement
          ? {
              tag: chinese.tagName.toLowerCase(),
              className: chinese.className,
              lang: chinese.lang,
              text: chinese.textContent,
            }
          : null,
    };
  };
  const tips = dialog.querySelectorAll('.quality-tips > li');
  const buttons = within(dialog).getAllByRole('button');

  return {
    ariaLabel: dialog.getAttribute('aria-label'),
    heading: bilingual(dialog.querySelector('.err-row > span')),
    transfer: bilingual(tips[0] ?? null),
    onDevice: bilingual(tips[1] ?? null),
    agree: {
      childNodes: buttons[0]?.childNodes.length,
      text: buttons[0]?.textContent,
    },
    back: {
      childNodes: buttons[1]?.childNodes.length,
      text: buttons[1]?.textContent,
    },
  };
}

describe('CaptureCard extraction failures', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.downscaleToJpeg.mockReset();
    mocks.hasConsent.mockReset();
    mocks.grantConsent.mockReset();
    mocks.fetch.mockReset();

    mocks.hasConsent.mockReturnValue(true);
    mocks.downscaleToJpeg.mockResolvedValue(
      new Blob(['downscaled'], { type: 'image/jpeg' }),
    );

    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:lab-preview');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', TestURL);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('Image decoding is not available in jsdom')),
    );
    vi.stubGlobal('fetch', mocks.fetch);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['en', 'zh'] as const)(
    'keeps the pre-localization consent bytes and wrapper structure in %s',
    async (lang) => {
      mocks.hasConsent.mockReturnValue(false);

      await uploadAndSubmit(lang);
      const dialog = await screen.findByRole('dialog', {
        name: 'Before we read your report',
      });

      expect(consentRenderContract(dialog)).toEqual({
        ariaLabel: 'Before we read your report',
        heading: {
          childNodes: 2,
          en: 'Before we read your report',
          zh: {
            tag: 'span',
            className: 'zh',
            lang: 'zh',
            text: '在读取您的化验单之前',
          },
        },
        transfer: {
          childNodes: 2,
          en: 'Two things are sent to Anthropic (a US company): your photo — including any name, values, or hospital shown on it — so its text can be read; and anything you typed under “What the doctor told you”, so it can be translated.',
          zh: {
            tag: 'span',
            className: 'zh',
            lang: 'zh',
            text: '有两项内容会发送给美国公司 Anthropic：您的照片（包括其中的姓名、数值或医院信息），用于识别其中的文字；以及您在“医生说了什么”中输入的内容，用于翻译。',
          },
        },
        onDevice: {
          childNodes: 2,
          en: 'The meaning of your results is worked out on this device. We don’t save either on our servers, and neither is ever used for advertising. Anthropic does not use them to train its models, though it may hold them briefly (up to 30 days) for safety checks.',
          zh: {
            tag: 'span',
            className: 'zh',
            lang: 'zh',
            text: '结果的含义在本设备上计算。两者都不会保存在我们的服务器上，也绝不用于广告。Anthropic 不会用它们训练模型，但可能为安全检查短暂保留（最多 30 天）。',
          },
        },
        agree: {
          childNodes: 1,
          text: 'I agree — read my report · 我同意，读取报告',
        },
        back: {
          childNodes: 1,
          text: 'Back · 返回',
        },
      });
    },
  );

  it('renders all six consent entries as explicit Chinese fallbacks in bo', async () => {
    mocks.hasConsent.mockReturnValue(false);

    await uploadAndSubmit('bo');
    const dialog = await screen.findByRole('dialog', {
      name: 'Before we read your report',
    });

    expect(
      dialog.querySelectorAll(
        '[data-requested-lang="bo"][data-resolved-lang="zh"]',
      ),
    ).toHaveLength(5);
    expect(dialog).toHaveAttribute('data-requested-lang', 'bo');
    expect(dialog).toHaveAttribute('data-resolved-lang', 'zh');
    expect(
      dialog.querySelectorAll('[data-translation-review="unverified"]'),
    ).toHaveLength(0);
  });

  it('shows service-unavailable copy for 502, never reads the body, and retries the same file', async () => {
    const secret = 'ANTHROPIC_API_KEY=server-only-secret';
    const { json, response } = failedResponse(502, secret);
    mocks.fetch.mockResolvedValue(response);

    const { file, user } = await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(
      'The report-reading service is temporarily unavailable. Please try again in a moment.',
    );
    expect(alert).toHaveTextContent('报告读取服务暂时不可用。请稍后重试。');
    expect(alert).not.toHaveTextContent(
      /We couldn’t read this photo clearly|brighter|flatter|Retake|更亮|更平整|重拍/i,
    );
    expect(alert).not.toHaveTextContent(secret);
    expect(json).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: 502,
      cause: 'server-unavailable',
    });

    await user.click(
      within(alert).getByRole('button', { name: 'Try again · 重试' }),
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.downscaleToJpeg).toHaveBeenCalledTimes(2);
    expect(mocks.downscaleToJpeg).toHaveBeenNthCalledWith(1, file);
    expect(mocks.downscaleToJpeg).toHaveBeenNthCalledWith(2, file);
    expect(json).not.toHaveBeenCalled();
  });

  it('shows network-scoped rate-limit copy for 429 without reading or leaking the response body', async () => {
    const secret = 'ANTHROPIC_API_KEY=server-only-secret';
    const { json, response } = failedResponse(429, secret);
    mocks.fetch.mockResolvedValue(response);

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(
      'Too many report-reading requests have been made from this network. Please wait and try again later.',
    );
    expect(alert).toHaveTextContent('当前网络的报告读取请求次数过多。请稍后重试。');
    expect(
      within(alert).getByRole('button', { name: 'Try again later · 稍后重试' }),
    ).toBeInTheDocument();
    expect(alert).not.toHaveTextContent(
      /photo|brighter|flatter|Retake|照片|更亮|更平整|重拍/i,
    );
    expect(alert).not.toHaveTextContent(secret);
    expect(json).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: 429,
      cause: 'rate-limited',
    });
  });

  it('routes a server 403 directly back to the contextual consent dialog', async () => {
    const { json, response } = failedResponse(403, 'Consent required');
    mocks.fetch.mockResolvedValue(response);

    await uploadAndSubmit();
    const dialog = await screen.findByRole('dialog', {
      name: 'Before we read your report',
    });

    expect(dialog).toHaveTextContent(
      'Please confirm your consent again before the photo is sent for reading.',
    );
    expect(dialog).toHaveTextContent('发送照片进行读取前，请再次确认您的同意。');
    expect(
      within(dialog).getByRole('button', { name: /I agree — read my report/i }),
    ).toBeInTheDocument();
    expect(json).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: 403,
      cause: 'not-permitted',
    });
  });

  it('shows honest retake copy for an unreadable 422 response', async () => {
    const { json, response } = failedResponse(422, 'Could not read the report');
    mocks.fetch.mockResolvedValue(response);

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expectUnreadablePresentation(alert);
    expect(json).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: 422,
      cause: 'unreadable',
    });
  });

  it.each([413, 415])('offers another photo when the server rejects the image with %i', async (status) => {
    const { json, response } = failedResponse(status, 'server detail must stay private');
    mocks.fetch.mockResolvedValue(response);

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(
      'This image is too large or uses a format we can’t accept. Choose a smaller image or retake the photo.',
    );
    expect(alert).toHaveTextContent(
      '这张图片过大，或格式不受支持。请选择较小的图片，或重新拍照。',
    );
    expect(
      within(alert).getByRole('button', { name: 'Retake or choose another · 重拍或另选' }),
    ).toBeInTheDocument();
    expect(json).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status,
      cause: 'image-rejected',
    });
  });

  it('classifies a missing canvas Blob as image-rejected instead of leaving the UI stuck', async () => {
    mocks.downscaleToJpeg.mockResolvedValue(null as unknown as Blob);

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(
      'This image is too large or uses a format we can’t accept.',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: null,
      cause: 'image-rejected',
    });
  });

  it('shows network copy and a retry action when fetch rejects', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(
      'We couldn’t connect to the report-reading service. Check your connection and try again.',
    );
    expect(alert).toHaveTextContent(
      '无法连接到报告读取服务。请检查网络连接后重试。',
    );
    expect(
      within(alert).getByRole('button', { name: 'Try again · 重试' }),
    ).toBeInTheDocument();
    expect(alert).not.toHaveTextContent(/Retake|重拍/i);
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: null,
      cause: 'network',
    });
  });

  it('treats a 200 response that fails the extraction schema as unreadable', async () => {
    const { json, response } = successfulResponse({
      data: {
        rows: [
          {
            name: 'GLU',
            value: '5.5',
            unit: 'mmol/L',
            printedRange: null,
            confidence: 'certain',
          },
        ],
      },
    });
    mocks.fetch.mockResolvedValue(response);

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expectUnreadablePresentation(alert);
    expect(json).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: 200,
      cause: 'unreadable',
    });
  });

  // Defence in depth behind the route's 422: a schema-valid but EMPTY extraction must land on
  // Retake, never on a result screen. An empty report shown as a successful read is false
  // reassurance by omission.
  it('treats a 200 response with zero extracted rows as unreadable', async () => {
    const { json, response } = successfulResponse({ data: { rows: [] } });
    mocks.fetch.mockResolvedValue(response);

    await uploadAndSubmit();
    const alert = await screen.findByRole('alert');

    expectUnreadablePresentation(alert);
    expect(json).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('capture submission failed', {
      status: 200,
      cause: 'unreadable',
    });
  });

  it('preserves a quality override when retrying the same photo after a 502', async () => {
    const { response } = failedResponse(502, 'Could not read the report');
    mocks.fetch.mockResolvedValue(response);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 3, height: 3 }),
    );
    const rgba = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: rgba })),
    } as unknown as CanvasRenderingContext2D);

    const { user } = await uploadAndSubmit();
    const qualityAlert = await screen.findByRole('alert');
    expect(qualityAlert).toHaveTextContent('This photo may be hard to read clearly.');

    await user.click(
      within(qualityAlert).getByRole('button', { name: 'Use it anyway · 仍然使用' }),
    );
    const serviceAlert = await screen.findByRole('alert');
    expect(serviceAlert).toHaveTextContent(
      'The report-reading service is temporarily unavailable.',
    );

    await user.click(
      within(serviceAlert).getByRole('button', { name: 'Try again · 重试' }),
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('This photo may be hard to read clearly.')).not.toBeInTheDocument();
  });
});
