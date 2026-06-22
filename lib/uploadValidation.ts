export const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw → ~5.3MB base64, under the 10MB API cap

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type UploadCheck =
  | { ok: true; mediaType: ImageMediaType }
  | { ok: false; status: 400 | 413 | 415; error: string };

export function checkUpload(file: { type: string; size: number } | null): UploadCheck {
  if (!file) return { ok: false, status: 400, error: 'No image provided' };
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return { ok: false, status: 415, error: 'Unsupported image type' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: 'Image too large' };
  return { ok: true, mediaType: file.type as ImageMediaType };
}
