import { describe, it, expect } from 'vitest';
import { checkUpload, MAX_IMAGE_BYTES } from './uploadValidation';

describe('checkUpload', () => {
  it('rejects missing file', () => {
    expect(checkUpload(null)).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects unsupported type', () => {
    expect(checkUpload({ type: 'application/pdf', size: 10 })).toMatchObject({ ok: false, status: 415 });
  });
  it('rejects oversize image', () => {
    expect(checkUpload({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 })).toMatchObject({ ok: false, status: 413 });
  });
  it('accepts a valid jpeg', () => {
    expect(checkUpload({ type: 'image/jpeg', size: 1000 })).toMatchObject({ ok: true, mediaType: 'image/jpeg' });
  });
});
