export function computeTargetSize(
  w: number,
  h: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// Browser-only: downscale + recompress to JPEG. (Not unit-tested; relies on canvas.)
export async function downscaleToJpeg(file: File, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = computeTargetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality));
}
