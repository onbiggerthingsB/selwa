import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LANG_PREFERENCE_KEY } from '@/lib/langPreference';
import AdvicePage from './page';

describe('advice page T1 shell', () => {
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

  it('uses a UI-only loading shell and then renders the honest unavailable state without a request', () => {
    vi.useFakeTimers();
    render(<AdvicePage />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Your health question' }), {
      target: { value: 'How can I sleep better?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my question' }));

    expect(screen.getByText('Checking availability')).toBeInTheDocument();
    expect(screen.getByText('Chinese Medicine')).toBeInTheDocument();
    expect(screen.getByText('Tibetan Medicine')).toBeInTheDocument();
    expect(screen.getByText('Western Medicine')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(50));
    const unavailable = screen.getByRole('alert');
    expect(unavailable).toHaveTextContent('Health suggestions are not available yet.');
    expect(unavailable).toHaveTextContent(
      'The page is ready, but the answer service will stay unavailable until its safety checks are in place.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('advice-disclaimer')).toHaveLength(5);
    expect(screen.getByTestId('advice-referral')).toBeInTheDocument();
  });

  it('keeps the safety frame present before, during, and after the stub transition', () => {
    vi.useFakeTimers();
    render(<AdvicePage />);

    const assertFrame = () => {
      expect(screen.getAllByTestId('advice-disclaimer')).toHaveLength(5);
      expect(screen.getByTestId('advice-referral')).toBeInTheDocument();
    };

    assertFrame();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your health question' }), {
      target: { value: 'A question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my question' }));
    expect(screen.getByText('Checking availability')).toBeInTheDocument();
    assertFrame();
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    assertFrame();
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
});
