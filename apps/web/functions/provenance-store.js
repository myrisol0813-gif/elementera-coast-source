const schemaPromises = new WeakMap();
const RESOURCE_TYPES = new Set(['soil', 'pocket']);

function clip(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
  const values = fields.map((field) => Number(value[field]));
  if (!values.every((number) => Number.isFinite(number) && number >= 0)) return null;
  return Object.fromEntries(fields.map((field, index) => [field, Math.trunc(values[index])]));
}

function parseUsage(value) {
  try {
    return normalizeUsage(JSON.parse(value || 'null'));
  } catch {
    return null;
  }
}

function iso(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

async function ensureSchema(db) {
  let ready = schemaPromises.get(db);
  if (!ready) {
    ready = db.prepare(`CREATE TABLE IF NOT EXISTS generation_provenance (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      usage_json TEXT,
      generation_source TEXT,
      generated_at INTEGER NOT NULL,
      PRIMARY KEY (resource_type, resource_id)
    )`).run();
    schemaPromises.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}

function resourceType(value) {
  const type = String(value || '');
  if (!RESOURCE_TYPES.has(type)) throw new Error('invalid_provenance_resource');
  return type;
}

export async function saveGenerationProvenance(db, typeValue, idValue, value = {}) {
  await ensureSchema(db);
  const type = resourceType(typeValue);
  const id = clip(idValue, 180);
  const modelId = clip(value.model_id, 180);
  if (!id || !modelId) return null;
  const usage = normalizeUsage(value.usage);
  const source = clip(value.generation_source, 40) || null;
  const generatedAt = Number.isFinite(Number(value.generated_at)) && Number(value.generated_at) > 0
    ? Math.trunc(Number(value.generated_at))
    : Date.now();
  await db.prepare(`INSERT INTO generation_provenance (
      resource_type, resource_id, model_id, usage_json, generation_source, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(resource_type, resource_id) DO UPDATE SET
      model_id = excluded.model_id,
      usage_json = excluded.usage_json,
      generation_source = excluded.generation_source,
      generated_at = excluded.generated_at`)
    .bind(type, id, modelId, usage ? JSON.stringify(usage) : null, source, generatedAt)
    .run();
  return { model_id: modelId, usage, generation_source: source, generated_at: iso(generatedAt) };
}

export async function readGenerationProvenance(db, typeValue, idValue) {
  await ensureSchema(db);
  const type = resourceType(typeValue);
  const id = clip(idValue, 180);
  if (!id) return null;
  const row = await db.prepare(`SELECT model_id, usage_json, generation_source, generated_at
    FROM generation_provenance WHERE resource_type = ? AND resource_id = ?`)
    .bind(type, id)
    .first();
  if (!row) return null;
  return {
    model_id: row.model_id || '',
    usage: parseUsage(row.usage_json),
    generation_source: row.generation_source || null,
    generated_at: iso(row.generated_at),
  };
}

export async function decorateSoilProvenance(db, soil) {
  if (!soil?.conversation_id) return soil;
  const provenance = await readGenerationProvenance(db, 'soil', soil.conversation_id);
  if (!provenance?.model_id) return soil;
  return {
    ...soil,
    organized_by_model: provenance.model_id,
    organize_usage: provenance.usage,
    organized_at: provenance.generated_at,
  };
}

export async function decoratePocketProvenance(db, pocket) {
  if (!pocket?.id) return pocket;
  const provenance = await readGenerationProvenance(db, 'pocket', pocket.id);
  if (!provenance?.model_id) return pocket;
  return {
    ...pocket,
    generated_by_model: provenance.model_id,
    generation_source: provenance.generation_source || 'soil',
    generation_usage: provenance.usage,
  };
}

export async function decoratePocketsProvenance(db, pockets) {
  return Promise.all((Array.isArray(pockets) ? pockets : []).map((pocket) => decoratePocketProvenance(db, pocket)));
}
