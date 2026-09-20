import { sanitizeId } from '../chat-store.js';
import { deleteEntryVector, syncEntryVector } from '../embedding.js';
import { json, methodNotAllowed } from '../http.js';
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  patchEntry,
} from '../memory-store.js';
import { body, memorySuffix } from './memory-request.js';

const ENTRIES_PATH = '/api/memory/entries';

export async function routeMemoryEntries(request, env, url) {
  const suffix = memorySuffix(url.pathname, ENTRIES_PATH);
  if (!suffix) {
    if (request.method === 'GET') {
      const result = await listEntries(env.COAST_CHAT_DB, {
        conversation_id: url.searchParams.get('conversation_id') || '',
        entry_type: url.searchParams.get('entry_type') || '',
        status: url.searchParams.get('status') || '',
        library_only: url.searchParams.get('library') === '1',
        source_model: url.searchParams.get('source_model') || '',
        source_window: url.searchParams.get('source_window') || '',
        tag: url.searchParams.get('tag') || '',
        source_time: url.searchParams.get('source_time') || '',
        q: url.searchParams.get('q') || '',
        limit: url.searchParams.get('limit') || '',
        cursor: url.searchParams.get('cursor') || '',
      });
      return json({ ok: true, ...result });
    }
    if (request.method === 'POST') {
      const entry = await createEntry(env.COAST_CHAT_DB, await body(request));
      return json({ ok: true, entry: (await syncEntryVector(env, env.COAST_CHAT_DB, entry)).entry }, 201);
    }
    return methodNotAllowed('GET, POST');
  }

  const entryId = sanitizeId(suffix.split('/')[0], 'memory');
  if (request.method === 'GET') return json({ ok: true, entry: await getEntry(env.COAST_CHAT_DB, entryId) });
  if (request.method === 'PATCH') {
    const result = await patchEntry(env.COAST_CHAT_DB, entryId, await body(request));
    result.entry = (await syncEntryVector(env, env.COAST_CHAT_DB, result.entry)).entry;
    return json({ ok: true, ...result });
  }
  if (request.method === 'DELETE') {
    const entry = await deleteEntry(env.COAST_CHAT_DB, entryId);
    const vector = await deleteEntryVector(env, entry);
    return json({ ok: true, entry, vector, deleted: true });
  }
  return methodNotAllowed('GET, PATCH, DELETE');
}
