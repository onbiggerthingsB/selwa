import { Fragment, type ComponentPropsWithoutRef, type ReactNode } from 'react';

const STANDARD_TSHEG = String.fromCodePoint(0x0f0b);

// Non-linguistic code-point fixture for checking Tibetan font shaping. Keeping
// this generated (rather than a source-language string) prevents test plumbing
// from being mistaken for reviewed Tibetan content.
const STACKED_GLYPH_FIXTURES = [
  [0x0f40, 0x0fb1, 0x0f72],
  [0x0f42, 0x0fb2, 0x0f74],
  [0x0f66, 0x0f90, 0x0fb1, 0x0f72],
] as const;

export const TIBETAN_TYPOGRAPHY_SAMPLE = STACKED_GLYPH_FIXTURES
  .map((codePoints) => String.fromCodePoint(...codePoints))
  .join(STANDARD_TSHEG);

function addTshegBreakOpportunities(text: string): ReactNode {
  const parts = text.split(STANDARD_TSHEG);

  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && (
        <>
          {STANDARD_TSHEG}
          <wbr data-tsheg-break />
        </>
      )}
    </Fragment>
  ));
}

type TibetanTextProps = Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'dir' | 'lang'> & {
  children: string;
};

export function TibetanText({ children, className, ...props }: TibetanTextProps) {
  return (
    <span {...props} className={className ? `bo ${className}` : 'bo'} lang="bo">
      {addTshegBreakOpportunities(children)}
    </span>
  );
}
