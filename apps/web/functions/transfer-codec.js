export const TRANSFER_FORMAT = 'elementera-coast-transfer';
export const TRANSFER_VERSION = 1;
export const TRANSFER_FILE_LIMIT = 64 * 1024 * 1024;
export const TRANSFER_CLOUD_LIMIT = 8 * 1024 * 1024;
const utf8 = new TextEncoder();
export class TransferError extends Error {
  constructor(type, message, status = 400) { super(message); this.type = type; this.status = status; }
}
export const bytes = value => utf8.encode(value).byteLength;
export function requireTransfer(condition, message, type = 'invalid_transfer', status = 400) {
  if (!condition) throw new TransferError(type, message, status);
}
export function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) { return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
export async function hashTransferText(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function validate(payload) {
  requireTransfer(exact(payload, ['source', 'exported_at', 'modules', 'excluded_modules']), '数据包目录无效。');
  const { source, modules, excluded_modules } = payload;
  requireTransfer(exact(source, ['application', 'mode']) && typeof source.application === 'string' &&
    source.application.length >= 1 && source.application.length <= 100 && ['local', 'backend'].includes(source.mode), '来源信息无效。');
  requireTransfer(typeof payload.exported_at === 'string' && Number.isFinite(Date.parse(payload.exported_at)), '导出时间无效。');
  requireTransfer(object(modules) && Object.keys(modules).length > 0 &&
    Object.keys(modules).every(key => /^[a-z][a-z0-9_]{0,63}$/.test(key)), '模块目录无效。');
  requireTransfer(Array.isArray(excluded_modules) && excluded_modules.every(x => typeof x === 'string'), '排除模块目录无效。');
}
export async function encodeTransfer(payload) {
  validate(payload);
  const payload_json = JSON.stringify(payload);
  const envelope = { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, sha256: await hashTransferText(payload_json), payload_json };
  requireTransfer(bytes(JSON.stringify(envelope)) <= TRANSFER_FILE_LIMIT, '数据包超过 64 MiB，未截断资料。', 'transfer_too_large', 413);
  return envelope;
}
export async function decodeTransfer(envelope) {
  requireTransfer(exact(envelope, ['format', 'version', 'sha256', 'payload_json']) &&
    envelope.format === TRANSFER_FORMAT && envelope.version === TRANSFER_VERSION &&
    typeof envelope.payload_json === 'string', '不支持的数据包格式或版本。');
  requireTransfer(bytes(JSON.stringify(envelope)) <= TRANSFER_FILE_LIMIT, '数据包超过 64 MiB。', 'transfer_too_large', 413);
  requireTransfer(typeof envelope.sha256 === 'string' && envelope.sha256 === await hashTransferText(envelope.payload_json), '数据包完整性校验失败。', 'checksum_mismatch');
  let payload;
  try { payload = JSON.parse(envelope.payload_json); } catch { throw new TransferError('invalid_transfer', '数据包内容不是有效 JSON。'); }
  validate(payload);
  return payload;
}
