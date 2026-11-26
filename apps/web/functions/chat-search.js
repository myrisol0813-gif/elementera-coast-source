import { ensureChatSchema } from './chat-store.js';

// Deliberately read-only: searching does not rewrite historic conversations or
// create a second copy of message text. D1 filters candidate JSON server-side.
export const CHAT_SEARCH_LIMITS = Object.freeze({
  query_chars: 100, page_results: 40, candidate_batch: 12, max_cursor_offset: 100000,
});

export class ChatSearchError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'ChatSearchError';
    this.type = type;
    this.status = status;
  }
}

function queryText(value) {
  const text = String(value || '').trim();
  if (!text || text.length > CHAT_SEARCH_LIMITS.query_chars) {
    throw new ChatSearchError('invalid_query', '请输入 1–100 字的搜索关键词。');
  }
  return text;
}

function parseCursor(value) {
  if (!value) return { conversationOffset: 0, matchOffset: 0 };
  const match = /^(\d+):(\d+)$/.exec(String(value));
  if (!match) throw new ChatSearchError('invalid_cursor', '搜索翻页位置无效。');
  const conversationOffset = Number(match[1]);
  const matchOffset = Number(match[2]);
  if (!Number.isSafeInteger(conversationOffset) || !Number.isSafeInteger(matchOffset)
      || conversationOffset > CHAT_SEARCH_LIMITS.max_cursor_offset || matchOffset > 100000) {
    throw new ChatSearchError('invalid_cursor', '搜索翻页位置已超出上限。');
  }
  return { conversationOffset, matchOffset };
}

function searchSnippet(value, query) {
  const content = String(value || '');
  const at = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (at < 0) return null;
  const from = Math.max(0, at - 65);
  const until = Math.min(content.length, at + query.length + 95);
  return {
    text: (from ? '…' : '') + content.slice(from, until) + (until < content.length ? '…' : ''),
    matched_offset: at,
  };
}

function addVariant(result, row, turn, role, variant, userIndex, assistantIndex, query) {
  if (typeof variant?.content !== 'string' || variant.hidden === true) return;
  const snippet = searchSnippet(variant.content, query);
  if (!snippet) return;
  result.push({
    kind: 'message', conversation_id: row.id, conversation_title: row.title,
    room_type: row.room_type, turn_id: turn.id, message_id: variant.id,
    variant_id: variant.id, role, user_variant_index: userIndex,
    assistant_variant_index: assistantIndex, created_at: variant.created_at || null,
    snippet: snippet.text, matched_offset: snippet.matched_offset,
  });
}

export function searchMatchesForConversation(row, query) {
  const matches = [];
  if (searchSnippet(row.title, query)) {
    matches.push({
      kind: 'conversation', conversation_id: row.id, conversation_title: row.title,
      room_type: row.room_type, snippet: row.title,
    });
  }
  let state;
  try { state = JSON.parse(row.state_json); }
  catch { return matches; } // Never overwrite, invent or erase corrupt historic JSON.
  const turns = Array.isArray(state.turns) ? [...state.turns].reverse() : [];
  for (const turn of turns) {
    const userVariants = Array.isArray(turn?.user?.variants) ? turn.user.variants : [];
    for (let userIndex = 0; userIndex < userVariants.length; userIndex += 1) {
      addVariant(matches, row, turn, 'user', userVariants[userIndex], userIndex, null, query);
      const assistants = turn?.assistant?.variantsByUserVariant?.[String(userIndex)] || [];
      for (let assistantIndex = 0; assistantIndex < assistants.length; assistantIndex += 1) {
        addVariant(matches, row, turn, 'assistant', assistants[assistantIndex],
          userIndex, assistantIndex, query);
      }
    }
  }
  return matches;
}

export async function searchChatMessages(db, { q, cursor = '', limit = 40 } = {}) {
  const query = queryText(q);
  const { conversationOffset, matchOffset } = parseCursor(cursor);
  const pageSize = Math.min(CHAT_SEARCH_LIMITS.page_results, Math.max(1, Number(limit) || 40));
  await ensureChatSchema(db);
  // Escape LIKE metacharacters. The full phrase is searched; never build SQL from user input.
  const like = '%' + query.replace(/[!%_]/g, (char) => '!' + char) + '%';
  const response = [];
  let offset = conversationOffset;
  let inside = matchOffset;
  // Fetch one bounded batch. A continuation cursor resumes even inside a very long conversation.
  const raw = await db.prepare(
    "SELECT c.id, c.title, c.room_type, s.state_json FROM conversations c " +
    "JOIN conversation_states s ON s.conversation_id = c.id " +
    "WHERE c.user_id = 'owner' AND c.deleted_at IS NULL AND c.conversation_kind = 'chat' AND c.source != 'sticker_library' " +
    "AND (c.title LIKE ? ESCAPE '!' OR s.state_json LIKE ? ESCAPE '!') " +
    "ORDER BY c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?"
  ).bind(like, like, CHAT_SEARCH_LIMITS.candidate_batch + 1, offset).all();
  const rows = raw?.results || [];
  const currentBatch = rows.slice(0, CHAT_SEARCH_LIMITS.candidate_batch);
  for (const row of currentBatch) {
    const matches = searchMatchesForConversation(row, query);
    for (let i = inside; i < matches.length; i += 1) {
      response.push(matches[i]);
      if (response.length >= pageSize) {
        const nextIndex = i + 1;
        const next = nextIndex < matches.length
          ? String(offset) + ':' + String(nextIndex)
          : String(offset + 1) + ':0';
        return { results: response, next_cursor: next, limits: CHAT_SEARCH_LIMITS };
      }
    }
    offset += 1;
    inside = 0;
  }
  return {
    results: response,
    next_cursor: rows.length > CHAT_SEARCH_LIMITS.candidate_batch ? String(offset) + ':0' : null,
    limits: CHAT_SEARCH_LIMITS,
  };
}
