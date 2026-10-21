import { readConversationState, sanitizeId } from './chat-store.js';

export const VOICE_LIMITS = Object.freeze({ text_chars: 2400, clips_per_message: 12, paragraphs_per_clip: 40, audio_bytes: 4 * 1024 * 1024 });
// Voice selection belongs to the self-hosting owner. No voice identity is bundled in public source.
const schemaReady = new WeakMap();
const CHUNK_BYTES = 180000;

export class VoiceClipError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'VoiceClipError';
    this.type = type;
    this.status = status;
  }
}
async function init(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS coast_voice_clips (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT, message_id TEXT,
    source TEXT NOT NULL, model_label TEXT, voice_id TEXT NOT NULL, text TEXT NOT NULL,
    audio_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coast_voice_chunks (
    clip_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, body_b64 TEXT NOT NULL,
    PRIMARY KEY(clip_id, chunk_index)
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_coast_voice_conversation ON coast_voice_clips(conversation_id, created_at)').run();
}
export async function ensureVoiceSchema(db) {
  if (!db) throw new VoiceClipError('database_unavailable', '海岸语音暂时无法连接数据库。', 503);
  let pending = schemaReady.get(db);
  if (!pending) { pending = init(db); schemaReady.set(db, pending); }
  try { await pending; } catch (error) { schemaReady.delete(db); throw error; }
}
function variantsOf(state) {
  const out = [];
  for (const turn of state.turns || []) {
    for (const items of Object.values(turn.assistant?.variantsByUserVariant || {})) {
      for (const item of items || []) out.push({ ...item, turn_id: turn.id });
    }
  }
  return out;
}
function paragraphsOf(text) {
  return String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}
async function sourceText(db, conversationId, messageId, indices) {
  const state = await readConversationState(db, conversationId);
  const source = variantsOf(state).find(x => x.id === messageId);
  if (!source) throw new VoiceClipError('message_not_found', '原来的助手消息不存在。', 404);
  const paragraphs = paragraphsOf(source.content);
  if (!Array.isArray(indices) || !indices.length || indices.length > paragraphs.length || indices.length > VOICE_LIMITS.paragraphs_per_clip
    || new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= paragraphs.length)) {
    throw new VoiceClipError('invalid_selection', '请选择原消息中的一段或多段正文。');
  }
  return { text: [...indices].sort((a,b)=>a-b).map(i=>paragraphs[i]).join('\n\n'), turn_id: source.turn_id };
}
function asBase64(bytes) {
  let text = '';
  for (let p = 0; p < bytes.length; p += 0x8000) text += String.fromCharCode(...bytes.subarray(p, p + 0x8000));
  return btoa(text);
}
function fromBase64(value) {
  const s = atob(value); const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) arr[i] = s.charCodeAt(i);
  return arr;
}
function meta(row) {
  return {
    id: row.id, conversation_id: row.conversation_id, turn_id: row.turn_id,
    message_id: row.message_id, source: row.source, model_label: row.model_label,
    voice_id: row.voice_id, text: row.text, audio_bytes: row.audio_bytes,
    created_at: row.created_at,
    audio_url: `/api/voice/clips/${encodeURIComponent(row.id)}/audio`,
  };
}
export async function listVoiceClips(db, conversationId) {
  await ensureVoiceSchema(db);
  await readConversationState(db, conversationId);
  const result = await db.prepare('SELECT * FROM coast_voice_clips WHERE conversation_id = ? ORDER BY created_at ASC')
    .bind(conversationId).all();
  return (result.results || []).map(meta);
}
export async function voiceClipAudio(db, id) {
  await ensureVoiceSchema(db);
  const row = await db.prepare('SELECT * FROM coast_voice_clips WHERE id = ?').bind(id).first();
  if (!row) throw new VoiceClipError('clip_not_found', '这段语音不存在。', 404);
  await readConversationState(db, row.conversation_id);
  const chunks = (await db.prepare('SELECT body_b64 FROM coast_voice_chunks WHERE clip_id = ? ORDER BY chunk_index ASC').bind(id).all()).results || [];
  const bytes = new Uint8Array(row.audio_bytes);
  let at = 0;
  for (const chunk of chunks) {
    const part = fromBase64(chunk.body_b64);
    if (at + part.length > bytes.length) throw new VoiceClipError('clip_corrupt', '语音文件已损坏。', 500);
    bytes.set(part, at); at += part.length;
  }
  if (at !== bytes.length) throw new VoiceClipError('clip_corrupt', '语音文件不完整。', 500);
  return bytes;
}

export async function generateVoiceClip(db, env, input, context = {}) {
  await ensureVoiceSchema(db);
  const conversationId = sanitizeId(input.conversation_id || context.conversation_id || '', 'conversation');
  if (!input.conversation_id && !context.conversation_id) throw new VoiceClipError('conversation_required', '必须提供对应的海岸聊天窗口。');
  const messageId = String(input.message_id || '').trim();
  const source = messageId
    ? await sourceText(db, conversationId, messageId, input.paragraph_indices)
    : (await readConversationState(db, conversationId), { text: String(input.text || '').trim(), turn_id: context.source_turn_id || null });
  const text = source.text;
  if (!text || text.length > VOICE_LIMITS.text_chars) {
    throw new VoiceClipError('text_limit', `一次最多可生成 ${VOICE_LIMITS.text_chars} 字的语音，请减少选段。`);
  }
  const current = await listVoiceClips(db, conversationId);
  if (messageId && current.filter(c => c.message_id === messageId).length >= VOICE_LIMITS.clips_per_message) {
    throw new VoiceClipError('clip_limit', `同一消息最多留存 ${VOICE_LIMITS.clips_per_message} 段语音。`);
  }
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  const voiceId = String(env.ELEVENLABS_VOICE_ID || '').trim();
  if (!key || !/^[a-zA-Z0-9_-]{8,80}$/.test(voiceId)) throw new VoiceClipError('voice_not_configured', '请在服务端配置 ELEVENLABS_API_KEY 和 ELEVENLABS_VOICE_ID。', 503);
  let response;
  try {
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new VoiceClipError('voice_provider_unavailable', 'ElevenLabs 暂时无法连接，请稍后重试。', 502);
  }
  if (!response.ok) throw new VoiceClipError('voice_provider_failed', `ElevenLabs 语音生成失败（HTTP ${response.status}），请检查额度与权限。`, 502);
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.length || data.length > VOICE_LIMITS.audio_bytes) throw new VoiceClipError('audio_limit', '生成音频为空或超过 4 MB 上限，未写入。', 413);
  const id = `voice_${crypto.randomUUID()}`;
  const now = Date.now();
  try {
    await db.prepare(`INSERT INTO coast_voice_clips
      (id,conversation_id,turn_id,message_id,source,model_label,voice_id,text,audio_bytes,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, conversationId, source.turn_id, messageId || null,
        context.surface === 'official_mcp' ? 'official_mcp' : context.surface === 'manual' ? 'manual' : 'coast_chat',
        String(context.model_label || input.model_label || '').slice(0, 180) || null, voiceId,
        text, data.length, now).run();
    for (let pos = 0, i = 0; pos < data.length; pos += CHUNK_BYTES, i += 1) {
      await db.prepare('INSERT INTO coast_voice_chunks (clip_id, chunk_index, body_b64) VALUES (?, ?, ?)')
        .bind(id, i, asBase64(data.subarray(pos, pos + CHUNK_BYTES))).run();
    }
  } catch {
    await db.prepare('DELETE FROM coast_voice_chunks WHERE clip_id = ?').bind(id).run().catch(()=>{});
    await db.prepare('DELETE FROM coast_voice_clips WHERE id = ?').bind(id).run().catch(()=>{});
    throw new VoiceClipError('voice_save_failed', '声音已生成，但没有成功保存，请稍后重试。', 500);
  }
  return meta(await db.prepare('SELECT * FROM coast_voice_clips WHERE id = ?').bind(id).first());
}
