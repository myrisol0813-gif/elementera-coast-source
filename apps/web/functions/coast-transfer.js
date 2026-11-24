// One portable wire format for both workspaces and both clients.
// Hash the exact UTF-8 payload text, not an engine's re-serialization of JSON.
export const TRANSFER_FORMAT = 'elementera-coast-transfer';
export const TRANSFER_VERSION = 1;
export const TRANSFER_LIMIT = 64 * 1024 * 1024;
export const CLOUD_IMPORT_LIMIT = 8 * 1024 * 1024;
export const TRANSFER_MODULES = Object.freeze(['chat', 'calendar', 'daily', 'model_profile']);
const encoder = new TextEncoder();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class TransferError extends Error {
  constructor(type, message, status = 400) { super(message); this.type = type; this.status = status; }
}
function require(ok, message) { if (!ok) throw new TransferError('invalid_transfer', message); }
export const byteLength = text => encoder.encode(text).byteLength;
export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function validateTransferPayload(payload) {
  require(isObject(payload), '数据包正文必须是对象。');
  require(Object.keys(payload).every(k => ['applicationId','workspace','exportedAt','includedModules','conversations','calendar','profile','dailyProfile','moments','diaries'].includes(k)), '数据包含未声明字段。');
  require(typeof payload.applicationId === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(payload.applicationId), '来源应用无效。');
  require(['local','backend'].includes(payload.workspace), '来源工作区无效。');
  require(typeof payload.exportedAt === 'string' && Number.isFinite(Date.parse(payload.exportedAt)), '导出时间无效。');
  require(Array.isArray(payload.includedModules) && payload.includedModules.every(k => TRANSFER_MODULES.includes(k)) && new Set(payload.includedModules).size === payload.includedModules.length, '模块声明无效。');
  for (const key of ['conversations','calendar','moments','diaries']) require(Array.isArray(payload[key]), '数据包列表不完整。');
  for (const key of ['profile','dailyProfile']) require(payload[key] === null || isObject(payload[key]), '资料模块格式无效。');
  if (!payload.includedModules.includes('chat')) require(payload.conversations.length === 0, '未声明聊天模块。');
  if (!payload.includedModules.includes('calendar')) require(payload.calendar.length === 0, '未声明日历模块。');
  if (!payload.includedModules.includes('daily')) require(payload.dailyProfile === null && !payload.moments.length && !payload.diaries.length, '未声明日报模块。');
  if (!payload.includedModules.includes('model_profile')) require(payload.profile === null, '未声明模型资料模块。');
  return payload;
}
export async function encodeTransfer(payload) {
  validateTransferPayload(payload);
  const payload_json = JSON.stringify(payload);
  const envelope = { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, sha256: await sha256(payload_json), payload_json };
  if (byteLength(JSON.stringify(envelope)) > TRANSFER_LIMIT) throw new TransferError('transfer_too_large', '数据包超过 64 MiB；没有截断原记录。', 413);
  return envelope;
}
export async function decodeTransfer(envelope, limit = TRANSFER_LIMIT) {
  require(isObject(envelope) && Object.keys(envelope).length === 4 && envelope.format === TRANSFER_FORMAT && envelope.version === TRANSFER_VERSION, '不支持的数据包格式或版本。');
  require(typeof envelope.payload_json === 'string' && /^[a-f0-9]{64}$/.test(envelope.sha256 || ''), '数据包校验字段无效。');
  if (byteLength(JSON.stringify(envelope)) > limit) throw new TransferError('transfer_too_large', '数据包超过目标工作区单次导入上限。', 413);
  require(await sha256(envelope.payload_json) === envelope.sha256, '数据包完整性校验失败。');
  let payload;
  try { payload = JSON.parse(envelope.payload_json); } catch { throw new TransferError('invalid_transfer', '数据包正文不是有效 JSON。'); }
  return validateTransferPayload(payload);
}
