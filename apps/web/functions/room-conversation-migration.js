const USER_ID = 'owner';
const MIGRATION_ID = 'chat-migrate-legacy-radio-lighthouse-v1';

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function tableExists(db, table) {
  return Boolean(await first(db, 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', table]));
}

function iso(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function userVariant(row, content) {
  const official = row.surface === 'official_mcp';
  return {
    id: id('legacy_user'),
    content,
    created_at: iso(row.created_at),
    message_source: official ? 'official_mcp' : 'owner_web',
    ...(row.display_author ? { display_author: row.display_author } : {}),
    ...(row.model_label ? { model_label: row.model_label } : {}),
  };
}

function userTurn(row, content) {
  return {
    id: id('legacy_turn'),
    user: { active: 0, variants: [userVariant(row, content)] },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [] } },
  };
}

function assistantVariant(row) {
  return {
    id: id('legacy_assistant'),
    content: row.withdrawn_at ? '这条消息已撤回' : String(row.text || ''),
    created_at: iso(row.created_at),
    ...(row.model_label ? { model_id: row.model_label } : {}),
    generation_source: 'radio',
  };
}

async function insertConversation(db, normalizeState, roomType, title, turns, timestamps) {
  if (!turns.length) return null;
  const positive = timestamps.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const now = Date.now();
  const createdAt = positive.length ? Math.min(...positive) : now;
  const updatedAt = positive.length ? Math.max(...positive) : now;
  const conversationId = id(`legacy_${roomType}`);
  const state = normalizeState({ turns, updated_at: iso(updatedAt) });
  await run(db, `INSERT INTO conversations (
    id, user_id, title, created_at, updated_at, deleted_at, title_manual,
    title_generated_at, title_model_id, archived_at, conversation_kind, room_type
  ) VALUES (?, ?, ?, ?, ?, NULL, 1, NULL, NULL, NULL, 'chat', ?)`, [
    conversationId,
    USER_ID,
    title,
    createdAt,
    updatedAt,
    roomType,
  ]);
  await run(db, `INSERT INTO conversation_states (conversation_id, state_json, updated_at)
    VALUES (?, ?, ?)`, [conversationId, JSON.stringify(state), updatedAt]);
  return conversationId;
}

async function migrateRadio(db, normalizeState) {
  if (!(await tableExists(db, 'coast_radio_messages'))) return null;
  const rows = await all(db, 'SELECT * FROM coast_radio_messages ORDER BY created_at ASC');
  const turns = [];
  for (const row of rows) {
    const isAssistant = row.surface === 'coast_api'
      || (row.surface !== 'official_mcp' && ['model_partner', 'api'].includes(String(row.actor || '')));
    if (isAssistant) {
      let turn = turns.at(-1);
      const assistants = turn?.assistant?.variantsByUserVariant?.['0'];
      if (!turn || !Array.isArray(assistants) || assistants.length) {
        turn = userTurn({ ...row, surface: 'web_manual' }, '（迁移前的对话上下文）');
        turn.user.variants[0].hidden = true;
        turns.push(turn);
      }
      turn.assistant.variantsByUserVariant['0'].push(assistantVariant(row));
      continue;
    }
    const text = row.withdrawn_at ? '这条消息已撤回' : String(row.text || '');
    if (text.trim()) turns.push(userTurn(row, text));
  }
  return insertConversation(
    db,
    normalizeState,
    'radio',
    '共通聊天室｜旧房迁移',
    turns,
    rows.map((row) => row.created_at),
  );
}

async function migrateLighthouse(db, normalizeState) {
  if (!(await tableExists(db, 'coast_lighthouse_letters'))) return null;
  const rows = await all(db, 'SELECT * FROM coast_lighthouse_letters ORDER BY created_at ASC');
  const turns = [];
  for (const row of rows) {
    const subject = String(row.subject || '').trim();
    const body = String(row.body || '').trim();
    const content = [subject, body].filter(Boolean).join('\n\n');
    if (content) turns.push(userTurn(row, content));
  }
  return insertConversation(
    db,
    normalizeState,
    'lighthouse',
    'MCP 对话区｜旧房迁移',
    turns,
    rows.map((row) => row.created_at),
  );
}

export async function migrateLegacyRooms(db, normalizeState) {
  if (await first(db, 'SELECT id FROM schema_migrations WHERE id = ?', [MIGRATION_ID])) {
    return { migrated: false, already_applied: true };
  }
  const radioConversationId = await migrateRadio(db, normalizeState);
  const lighthouseConversationId = await migrateLighthouse(db, normalizeState);
  await run(db, 'DROP TABLE IF EXISTS coast_radio_messages');
  await run(db, 'DROP TABLE IF EXISTS coast_lighthouse_letters');
  await run(db, 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', [MIGRATION_ID, Date.now()]);
  return {
    migrated: Boolean(radioConversationId || lighthouseConversationId),
    radio_conversation_id: radioConversationId,
    lighthouse_conversation_id: lighthouseConversationId,
  };
}

export const legacyRoomMigrationId = MIGRATION_ID;
