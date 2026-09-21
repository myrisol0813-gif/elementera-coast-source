export function shortModelName(modelId) {
  const raw = String(modelId || '').trim();
  if (!raw) return '';
  const bare = raw.split('/').at(-1)?.replace(/:free$/i, '') || '';
  if (!bare) return '';
  if (/^gpt-/i.test(bare)) {
    return bare.replace(/^gpt-/i, 'GPT-').replace(/-(nano|mini|micro)$/i, ' $1');
  }
  return bare;
}
