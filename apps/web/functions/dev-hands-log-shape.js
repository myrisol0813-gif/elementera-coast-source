const OMITTED_KEYS = /^(?:content|body|text|diff|patch|log|logs|bytes|release_notes|known_risk)$/iu;
const SENSITIVE_KEYS = /(?:token|secret|cookie|authorization|password|keystore|private[_-]?key|client[_-]?secret|env)/iu;

function omitted(value) {
  if (typeof value === 'string') return `[omitted:${value.length} chars]`;
  if (Array.isArray(value)) return `[omitted:${value.length} items]`;
  if (value && typeof value === 'object') {
    const size = Number.isFinite(Number(value.byteLength)) ? Number(value.byteLength)
      : Number.isFinite(Number(value.length)) ? Number(value.length)
        : null;
    return size == null ? '[omitted]' : `[omitted:${size} bytes]`;
  }
  return '[omitted]';
}

function shape(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 320);
  if (depth >= 3) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => shape(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 160);
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => {
    if (SENSITIVE_KEYS.test(key)) return [key, '[REDACTED]'];
    if (OMITTED_KEYS.test(key)) return [key, omitted(item)];
    return [key, shape(item, depth + 1)];
  }));
}

export function devLogShape(value) {
  return shape(value);
}
