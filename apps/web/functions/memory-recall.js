import { embedText, hasAiBinding, hasVectorBinding, queryVector, syncPendingEntries } from './embedding.js';
import { MEMORY_CONFIG, recallSettings } from './memory-config.js';
import { listRecallCandidates, markEntriesRecalled, readSoil } from './memory-store.js';
import { formatThinkingSoil } from './thinking-soil.js';

function lower(value) {
  return String(value || '').toLocaleLowerCase('zh-CN').trim();
}

function normalizedTitle(value) {
  return lower(value).replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 120);
}

function queryTokens(query) {
  return [...new Set(lower(query)
    .split(/[\s,，。！？!?、:：;；()（）「」“”]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2))].slice(0, 12);
}

function keywordScore(entry, query) {
  const needle = lower(query);
  if (!needle) return 0;
  const title = lower(entry.title);
  const core = lower(entry.life_core);
  const content = lower(entry.content);
  const usage = lower(entry.usage_hint);
  const avoid = lower(entry.avoid_hint);
  const tag = lower(entry.tag);
  if (title === needle) return 1;
  if (title.length >= 2 && needle.includes(title)) return 0.97;
  if (title.includes(needle)) return 0.94;
  if (core.includes(needle)) return 0.88;
  if (content.includes(needle)) return 0.76;
  if (usage.includes(needle)) return 0.70;
  const tokens = queryTokens(needle);
  if (!tokens.length) return 0;
  const haystack = `${title} ${core} ${content} ${usage} ${avoid} ${tag}`;
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched ? 0.46 + (matched / tokens.length) * 0.34 : 0;
}

export function isExplicitRecallQuery(query) {
  return /(你还记得|还记得吗|还记得|回想|找一下.*记忆|搜索.*记忆|查.*记忆|记忆里|种子库|记忆库|以前说过|我们聊过)/u.test(String(query || ''));
}

function ageDays(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 86400000) : 3650;
}

function recencyBonus(entry, maxBonus) {
  const age = ageDays(entry.last_confirmed_at || entry.source_time || entry.updated_at || entry.created_at);
  if (age <= 7) return maxBonus;
  if (age <= 30) return maxBonus * 0.7;
  if (age <= 90) return maxBonus * 0.35;
  return 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function topicKey(entry) {
  return `${lower(entry.tag)}:${normalizedTitle(entry.title)}`;
}

function recallItem(entry, score, reason) {
  return {
    id: entry.id,
    entry_type: entry.entry_type,
    title: entry.title,
    life_core: entry.life_core,
    usage_hint: entry.usage_hint,
    avoid_hint: entry.avoid_hint,
    content: entry.content,
    tag: entry.tag,
    source_model: entry.source_model,
    source_window: entry.source_window,
    source_time: entry.source_time,
    source_date: entry.source_date,
    score: Math.round(score * 10000) / 10000,
    reason,
  };
}

async function rankedRecall(env, db, query, {
  explicit,
  recentIds,
  settings,
  maxEntries = null,
} = {}) {
  const entries = await listRecallCandidates(db, { limit: 500 });
  const vectorEnabled = hasAiBinding(env) && hasVectorBinding(env) && Boolean(String(query || '').trim());
  let semanticScores = new Map();
  let vectorError = null;
  if (vectorEnabled) {
    try {
      await syncPendingEntries(env, db, 4);
      const values = await embedText(env, query);
      const matches = await queryVector(env, query, {
        values,
        topK: 40,
        filter: { user_id: MEMORY_CONFIG.owner },
      });
      semanticScores = new Map(matches.map((match) => [match.id, match.score]));
    } catch (error) {
      vectorError = String(error?.message || 'vector_query_failed').slice(0, 100);
    }
  }

  const limits = explicit ? settings.limits.explicit : settings.limits.auto;
  const totalLimit = Math.min(limits.total, maxEntries == null ? limits.total : Math.max(0, Number(maxEntries) || 0));
  const ranked = entries.map((entry) => {
    const keyword = keywordScore(entry, query);
    const semantic = entry.embedding_status === 'ready' ? Number(semanticScores.get(entry.id) || 0) : 0;
    const base = Math.max(keyword, semantic);
    const tagBonus = entry.tag && lower(query).includes(lower(entry.tag)) ? settings.tagBonus : 0;
    const windowBonus = entry.source_window && lower(query).includes(lower(entry.source_window)) ? settings.sourceWindowBonus : 0;
    const score = clampScore(
      base
      + tagBonus
      + windowBonus
      + recencyBonus(entry, settings.recencyBonus)
      - (entry.entry_type === 'seed' ? settings.seedPenalty : 0)
      - (entry.status === 'dormant' ? settings.dormantPenalty : 0),
    );
    const strongKeyword = keyword >= settings.thresholds.exactTitle;
    const threshold = explicit
      ? settings.thresholds.explicit
      : entry.entry_type === 'seed' ? settings.thresholds.autoSeed : settings.thresholds.autoMemory;
    const reason = keyword >= semantic && keyword > 0
      ? strongKeyword ? 'exact_or_strong_keyword' : 'keyword'
      : semantic > 0 ? 'semantic' : 'none';
    return { entry, score, reason, strongKeyword, threshold };
  }).filter((candidate) => {
    if (!explicit && recentIds.has(candidate.entry.id)) return false;
    return candidate.strongKeyword || candidate.score >= candidate.threshold;
  }).sort((left, right) => right.score - left.score
    || Date.parse(right.entry.updated_at || 0) - Date.parse(left.entry.updated_at || 0));

  const selected = [];
  const topics = new Set();
  let memories = 0;
  let seeds = 0;
  for (const candidate of ranked) {
    if (selected.length >= totalLimit) break;
    const topic = topicKey(candidate.entry);
    if (topic && topics.has(topic)) continue;
    if (candidate.entry.entry_type === 'memory') {
      if (memories >= limits.memory) continue;
      memories += 1;
    } else {
      if (seeds >= limits.seed) continue;
      seeds += 1;
    }
    if (topic) topics.add(topic);
    selected.push(recallItem(candidate.entry, candidate.score, candidate.reason));
  }
  return { items: selected, vector_enabled: vectorEnabled, ...(vectorError ? { vector_error: vectorError } : {}) };
}

export async function buildMemoryContext(env, owner, conversationId, query, options = {}) {
  if (owner !== MEMORY_CONFIG.owner) throw new Error('memory_owner_invalid');
  const db = env.COAST_CHAT_DB;
  const settings = recallSettings(options.settings || {});
  const recentIds = new Set((Array.isArray(options.recent_entry_ids) ? options.recent_entry_ids : []).map(String));
  const explicit = options.explicit === true || isExplicitRecallQuery(query);
  const ranked = await rankedRecall(env, db, query, { explicit, recentIds, settings });
  const selectedIds = ranked.items.map((entry) => entry.id);
  if (options.record_recall !== false) await markEntriesRecalled(db, selectedIds);
  return {
    items: ranked.items,
    selected_ids: selectedIds,
    vector_enabled: ranked.vector_enabled,
    ...(ranked.vector_error ? { vector_error: ranked.vector_error } : {}),
    soil: await readSoil(db, conversationId),
  };
}

function memoryField(label, value) {
  const text = String(value ?? '').trim();
  return text ? `${label}：${text}` : '';
}

function cleanMemoryLine(entry) {
  const type = entry?.entry_type === 'seed' ? 'seed' : 'memory';
  const score = Math.round((Number(entry?.score) || 0) * 10000) / 10000;
  return [
    memoryField('标题', entry?.title),
    `类型：${type}`,
    memoryField('标签', entry?.tag),
    memoryField('来源窗口', entry?.source_window),
    `分数：${score}`,
    memoryField('生命核', entry?.life_core),
    memoryField('使用时机', entry?.usage_hint),
    memoryField('勿误用', entry?.avoid_hint),
    memoryField('内容', entry?.content),
  ].filter(Boolean).join('\n');
}

export function recallMemoryItems(result) {
  return (Array.isArray(result?.items) ? result.items : []).map(cleanMemoryLine).filter(Boolean);
}

export function formatRecallMemoryContext(result) {
  const items = recallMemoryItems(result);
  return items.length ? ['【相关记忆】', ...items.map((item) => `- ${item}`)].join('\n') : '';
}

export function formatMemoryContext(result, rawSettings = {}) {
  return [
    formatThinkingSoil(result?.soil, { maxCharacters: recallSettings(rawSettings).soilBudget }),
    formatRecallMemoryContext(result),
  ].filter(Boolean).join('\n\n');
}

export async function searchMemory(env, owner, value = {}) {
  if (owner !== MEMORY_CONFIG.owner) throw new Error('memory_owner_invalid');
  const query = String(value.query || value.q || '').trim().slice(0, 240);
  const requestedLimit = Math.min(8, Math.max(1, Number(value.limit) || 8));
  const settings = recallSettings(value.settings || {});
  const ranked = await rankedRecall(env, env.COAST_CHAT_DB, query, {
    explicit: true,
    recentIds: new Set(),
    settings,
    maxEntries: requestedLimit,
  });
  return {
    entries: ranked.items,
    selected_ids: ranked.items.map((item) => item.id),
    vector_enabled: ranked.vector_enabled,
    ...(ranked.vector_error ? { vector_error: ranked.vector_error } : {}),
  };
}
