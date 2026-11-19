export interface PreviewFile { key: string; name: string; size: number }
export function previewFiles(value: unknown): PreviewFile[] {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return []; }
  }
  if (!Array.isArray(input)) return [];
  return input.slice(0, 10).filter((file): file is PreviewFile =>
    !!file && typeof file === 'object' && typeof file.key === 'string' && /^[a-f0-9]{64}$/.test(file.key) &&
    typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 255 && !/[\\/\u0000-\u001f]/.test(file.name) &&
    Number.isSafeInteger(file.size) && file.size > 0);
}
