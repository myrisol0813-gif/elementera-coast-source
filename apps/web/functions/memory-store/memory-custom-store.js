import { clip, first, iso, run } from './memory-db.js';
import { MAX_CUSTOM_INSTRUCTIONS } from './memory-normalize.js';
import { ensureMemorySchema } from './memory-schema.js';

function customInstructionsFromRow(row) {
  return {
    title: '当前自定义指令',
    content: row?.content || '',
    status: 'active',
    updated_at: iso(row?.updated_at),
    updated_by: row?.updated_by || 'xiaohan',
    source: row?.source || '屋主手动编辑',
  };
}

export async function readCustomInstructions(db) {
  await ensureMemorySchema(db);
  return customInstructionsFromRow(await first(db, `SELECT * FROM memory_custom_instructions
    WHERE id = 'active'`));
}

export async function writeCustomInstructions(db, value = {}) {
  await ensureMemorySchema(db);
  const content = clip(value.content, MAX_CUSTOM_INSTRUCTIONS);
  const updatedBy = clip(value.updated_by || 'xiaohan', 80) || 'xiaohan';
  const source = clip(value.source || '屋主手动编辑', 80) || '屋主手动编辑';
  const timestamp = Date.now();
  await run(db, `INSERT INTO memory_custom_instructions
    (id, content, updated_at, updated_by, source)
    VALUES ('active', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      source = excluded.source`, [content, timestamp, updatedBy, source]);
  return readCustomInstructions(db);
}
