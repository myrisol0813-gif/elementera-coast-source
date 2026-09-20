export const q = (selector, root = document) => root?.querySelector?.(selector) || null;

export const qa = (selector, root = document) => Array.from(root?.querySelectorAll?.(selector) || []);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export const escapeAttribute = escapeHtml;

export function clamp(value, length) {
  if (length < 1) return 0;
  return Math.min(Math.max(0, Number(value) || 0), length - 1);
}

export function id(prefix = 'id') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`.replace(/[^\w:.-]/g, '_').slice(0, 160);
}

export function sanitizeId(value, fallback = 'id') {
  const clean = String(value || '').replace(/[^\w:.-]/g, '_').slice(0, 160);
  return clean || id(fallback);
}

export function formatRichText(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || typeof FileReader === 'undefined') {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('image_read_failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_decode_failed'));
    image.src = dataUrl;
  });
}

export async function compressImageFile(file, {
  maxDimension = 512,
  maxDataUrlLength = 360_000,
  quality = 0.86,
} = {}) {
  const source = await readImageFile(file);
  if (!source) return '';
  if (!/^data:image\//i.test(source)) throw new Error('image_type_invalid');

  const image = await loadImage(source);
  if (!image || typeof document === 'undefined') {
    if (source.length > maxDataUrlLength) throw new Error('image_too_large');
    return source;
  }

  const longest = Math.max(Number(image.naturalWidth || image.width || 0), Number(image.naturalHeight || image.height || 0));
  if (!longest) throw new Error('image_decode_failed');
  let scale = Math.min(1, Math.max(1, Number(maxDimension) || 1) / longest);
  let currentQuality = Math.min(0.92, Math.max(0.45, Number(quality) || 0.86));

  for (let attempt = 0; attempt < 9; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext?.('2d');
    if (!context) {
      if (source.length > maxDataUrlLength) throw new Error('image_too_large');
      return source;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const output = canvas.toDataURL('image/webp', currentQuality);
    if (output && output.length <= maxDataUrlLength) return output;
    if (currentQuality > 0.54) currentQuality -= 0.08;
    else scale *= 0.82;
  }
  throw new Error('image_too_large');
}

export function chooseImage(accept = 'image/*') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.addEventListener('change', async () => {
      try {
        resolve(await readImageFile(input.files?.[0]));
      } catch (error) {
        reject(error);
      } finally {
        input.remove();
      }
    }, { once: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve('');
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function downloadFile(body, filename, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function timestampLabel(date = new Date()) {
  const two = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}
