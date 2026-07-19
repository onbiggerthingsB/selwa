import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TibetanText, TIBETAN_TYPOGRAPHY_SAMPLE } from './TibetanText';

const STANDARD_TSHEG = String.fromCodePoint(0x0f0b);
const NONBREAKING_TSHEG = String.fromCodePoint(0x0f0c);
const STACKED_CLUSTER = String.fromCodePoint(0x0f40, 0x0fb1, 0x0f72);

describe('TibetanText', () => {
  it('adds an optional break after each standard tsheg without changing the text', () => {
    const text = [STACKED_CLUSTER, STACKED_CLUSTER, STACKED_CLUSTER].join(STANDARD_TSHEG);

    render(<TibetanText data-testid="sample">{text}</TibetanText>);

    const sample = screen.getByTestId('sample');
    expect(sample).toHaveAttribute('lang', 'bo');
    expect(sample).toHaveClass('bo');
    expect(sample).not.toHaveAttribute('dir');
    expect(sample.textContent).toBe(text);
    expect(sample.querySelectorAll('wbr[data-tsheg-break]')).toHaveLength(2);
  });

  it('does not turn the dedicated nonbreaking tsheg into a break opportunity', () => {
    const text = `${STACKED_CLUSTER}${NONBREAKING_TSHEG}${STACKED_CLUSTER}`;

    render(<TibetanText data-testid="sample">{text}</TibetanText>);

    const sample = screen.getByTestId('sample');
    expect(sample.textContent).toBe(text);
    expect(sample.querySelector('wbr')).toBeNull();
  });

  it('provides a code-point-generated fixture containing stacked glyphs', () => {
    const codePoints = Array.from(TIBETAN_TYPOGRAPHY_SAMPLE, (character) =>
      character.codePointAt(0),
    );

    expect(codePoints).toContain(STANDARD_TSHEG.codePointAt(0));
    expect(codePoints.some((codePoint) => codePoint !== undefined
      && codePoint >= 0x0f90
      && codePoint <= 0x0fbc)).toBe(true);

    render(
      <TibetanText className="typography-probe" data-testid="sample">
        {TIBETAN_TYPOGRAPHY_SAMPLE}
      </TibetanText>,
    );

    const sample = screen.getByTestId('sample');
    expect(sample).toHaveClass('bo', 'typography-probe');
    expect(sample.textContent).toBe(TIBETAN_TYPOGRAPHY_SAMPLE);
    expect(sample.querySelectorAll('wbr[data-tsheg-break]')).toHaveLength(2);
  });
});
