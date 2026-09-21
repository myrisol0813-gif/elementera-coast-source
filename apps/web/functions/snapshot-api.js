import { listConversations, readConversationState, readProfile } from './chat-store.js';
import { getChatAttachmentRecord } from './chat-attachments.js';
import { getMysticDogtalk } from './dogtalk-store.js';
import {
  getDevSettings,
  listDevRuns,
  listUpdateRecords,
  redactSecretText,
} from './dev-hands-store.js';
import { allowedRepos } from './dev-hands-policy.js';
import {
  EXPECTED_NATIVE_APPLICATION_ID,
  PWA_CACHE_VERSION,
} from './dev-hands-version.js';
import {
  listEntries,
  listPockets,
  readCustomInstructions,
  readGlobalExcerpt,
  listGlobalExcerptCandidates,
  listGlobalExcerptRevisions,
  readSoil,
} from './memory-store.js';
import { listAllMessageModelMetadata } from './model-metadata-store.js';
import { listWorldbookEntries } from './worldbook.js';
import { listMoments, listDiaries } from './daily-store.js';
import { listToolRuns } from './tool-run-log.js';
import { mailboxOwnerSummary } from './mailbox-service.js';
import { apiError, json, methodNotAllowed } from './http.js';

const SNAPSHOT_PATH = '/api/export/v1-snapshot';
const FULL_ARCHIVE_PATH = '/api/export/full-archive';
const POCKET_STATUSES = Object.freeze(['pending', 'confirmed', 'discarded', 'stone', 'archived']);
const SENSITIVE_KEY = /(?:secret|cookie|authorization|keystore|password|api[_-]?key|private[_-]?key|client[_-]?secret|^token$|(?:access|refresh|bearer|github|notion|cloudflare|auth)[_-]?token)/iu;

function safeText(value, max = 2000000) {
  return redactSecretText(String(value ?? ''), max);
}

function redactSnapshot(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return safeText(value);
  if (depth > 18) return '[DEPTH REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactSnapshot(item, depth + 1));
  if (typeof value !== 'object') return safeText(String(value), 1000);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSnapshot(item, depth + 1);
  }
  return output;
}

function variants(turn) {
  const list = [];
  for (const item of turn?.user?.variants || []) list.push({ role: 'user', item });
  for (const items of Object.values(turn?.assistant?.variantsByUserVariant || {})) {
    for (const item of items || []) list.push({ role: 'assistant', item });
  }
  return list;
}

function attachmentIndex(conversation, state) {
  const output = [];
  for (const turn of state?.turns || []) {
    for (const { role, item } of variants(turn)) {
      for (const attachment of item?.attachments || []) {
        output.push({
          ...attachment,
          conversation_id: conversation.id,
          turn_id: turn.id,
          message_id: item.id || null,
          role,
          recoverable_url: `/api/chat/attachments/${encodeURIComponent(attachment.id)}?conversation_id=${encodeURIComponent(conversation.id)}`,
        });
      }
    }
  }
  return output;
}

function webSearchIndex(conversation, state) {
  const output = [];
  for (const turn of state?.turns || []) {
    for (const { role, item } of variants(turn)) {
      if (role !== 'assistant') continue;
      const receipt = item?.desk_slip?.web_search;
      if (!receipt || typeof receipt !== 'object') continue;
      output.push({
        conversation_id: conversation.id,
        turn_id: turn.id,
        message_id: item.id || null,
        used: receipt.used === true,
        available: receipt.available !== false,
        requested_query: String(receipt.requested_query || ''),
        requests: Math.max(0, Number(receipt.requests) || 0),
        results_count: Math.max(0, Number(receipt.results_count) || 0),
        results: Array.isArray(receipt.results) ? receipt.results : [],
        reason: receipt.reason || null,
      });
    }
  }
  return output;
}

function furnitureIndex(conversation, state) {
  const output = [];
  for (const turn of state?.turns || []) {
    for (const { role, item } of variants(turn)) {
      if (role !== 'assistant' || !Array.isArray(item?.furniture_runs)) continue;
      for (const run of item.furniture_runs) {
        output.push({
          conversation_id: conversation.id,
          turn_id: turn.id,
          message_id: item.id || null,
          ...run,
        });
      }
    }
  }
  return output;
}

async function allMemoryEntries(db) {
  const entries = [];
  let cursor = null;
  do {
    const page = await listEntries(db, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    entries.push(...(page.entries || []));
    cursor = page.next_cursor;
  } while (cursor && entries.length < 5000);
  return entries;
}

async function pocketsForConversation(db, conversationId) {
  const output = [];
  for (const status of POCKET_STATUSES) {
    const items = await listPockets(db, { conversation_id: conversationId, status });
    output.push(...items);
  }
  return output;
}

async function buildSnapshot(env) {
  const db = env.COAST_CHAT_DB;
  const conversations = await listConversations(db);
  const conversationRecords = [];
  const attachments = [];
  const webSearches = [];
  const furnitureRuns = [];
  const soils = [];
  const pockets = [];
  const dogtalk = [];

  for (const conversation of conversations) {
    const [state, soil, pocketItems, dog] = await Promise.all([
      readConversationState(db, conversation.id),
      readSoil(db, conversation.id),
      pocketsForConversation(db, conversation.id),
      getMysticDogtalk(db, { room_scope: 'conversation', conversation_id: conversation.id }),
    ]);
    conversationRecords.push({ conversation, history: state });
    soils.push({ conversation_id: conversation.id, soil });
    pockets.push(...pocketItems);
    if (dog?.id || dog?.body) dogtalk.push({ conversation_id: conversation.id, dogtalk: dog });
    attachments.push(...attachmentIndex(conversation, state));
    webSearches.push(...webSearchIndex(conversation, state));
    furnitureRuns.push(...furnitureIndex(conversation, state));
  }

  const [
    memoryEntries,
    customInstructions,
    worldbook,
    profile,
    moments,
    diaries,
    toolRuns,
    devRuns,
    updateRecords,
    devSettings,
    globalExcerpt,
    globalExcerptCandidates,
    globalExcerptRevisions,
    modelEchoSummaries,
    mailboxSummary,
  ] = await Promise.all([
    allMemoryEntries(db),
    readCustomInstructions(db),
    listWorldbookEntries(db, { include_disabled: true }),
    readProfile(db),
    listMoments(db, { limit: 300 }),
    listDiaries(db, { limit: 300 }),
    listToolRuns(db, { limit: 200 }),
    listDevRuns(db, { limit: 200 }),
    listUpdateRecords(db, 100),
    getDevSettings(db),
    readGlobalExcerpt(db),
    listGlobalExcerptCandidates(db),
    listGlobalExcerptRevisions(db, 500),
    listAllMessageModelMetadata(db, { includeRaw: false, limit: 10000 }),
    mailboxOwnerSummary(db),
  ]);

  const raw = {
    format: 'elementera-coast-v1-snapshot',
    version: 1,
    exported_at: new Date().toISOString(),
    scope: 'owner',
    included_modules: [
      'chat_windows',
      'radio',
      'lighthouse',
      'thinking_soil',
      'memory_entries',
      'memory_pockets',
      'global_excerpt',
      'global_excerpt_revisions',
      'worldbook',
      'custom_instructions',
      'dogtalk',
      'daily',
      'model_profile',
      'tool_settings',
      'tool_run_summaries',
      'model_echo_summaries',
      'dev_hand_run_summaries',
      'furniture_run_summaries',
      'update_records',
      'attachment_index',
      'web_search_summaries',
      'mailbox_owner_summary',
      'versions',
    ],
    excluded_modules: [
      'attachment_binary_payloads',
      'raw_sensitive_ci_logs',
      'provider_credentials',
      'github_secrets',
      'cloudflare_secrets',
      'keystore',
      'cookies',
      'authorization_headers',
      'mailbox_message_bodies',
      'mailbox_passphrase_verifiers',
      'mailbox_private_memory_bodies',
    ],
    redaction: {
      applied: true,
      rule: 'credential-shaped values and sensitive-key fields are redacted; server environment secrets are never read into the snapshot',
    },
    versions: {
      pwa_cache_version: PWA_CACHE_VERSION,
      expected_native_application_id: EXPECTED_NATIVE_APPLICATION_ID,
    },
    integrations: {
      github_allowlist: allowedRepos(env),
      notion_root_page_id: String(env.COAST_NOTION_ROOT_PAGE_ID || '').trim() || null,
    },
    chat: {
      conversations: conversationRecords,
      counts_by_room_type: Object.fromEntries(['main', 'radio', 'lighthouse'].map((room) => [
        room,
        conversations.filter((item) => item.room_type === room).length,
      ])),
    },
    thinking_soil: soils,
    memory: {
      entries: memoryEntries,
      pockets,
      custom_instructions: customInstructions,
      global_excerpt: {
        ...globalExcerpt,
        pending_candidates: globalExcerptCandidates,
        revisions: globalExcerptRevisions,
      },
    },
    worldbook,
    dogtalk,
    mailbox: {
      summary: mailboxSummary,
      privacy: 'sealed_visitor_content_excluded',
      message_bodies_included: false,
      credential_material_included: false,
    },
    daily: { moments, diaries },
    model_profile: profile,
    model_echo_summaries: modelEchoSummaries,
    tools: {
      settings: devSettings,
      runs: toolRuns,
      dev_hand_runs: devRuns,
      furniture_runs: furnitureRuns,
    },
    update_records: updateRecords,
    attachments: {
      count: attachments.length,
      items: attachments,
      binary_included: false,
    },
    web_search: {
      calls: webSearches,
      used_count: webSearches.filter((item) => item.used).length,
    },
  };
  return redactSnapshot(raw);
}

function base64Bytes(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array();
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
}

async function fullAttachmentPayloads(db, snapshot) {
  const items = Array.isArray(snapshot?.attachments?.items) ? snapshot.attachments.items : [];
  const unique = new Map();
  for (const item of items) {
    const key = `${item.conversation_id}:${item.id}`;
    if (!item.id || !item.conversation_id || unique.has(key)) continue;
    unique.set(key, item);
  }
  const output = [];
  for (const item of unique.values()) {
    try {
      const record = await getChatAttachmentRecord(db, item.conversation_id, item.id);
      output.push({
        id: item.id,
        conversation_id: item.conversation_id,
        turn_id: item.turn_id || null,
        message_id: item.message_id || null,
        role: item.role || null,
        name: item.name || record.name || '附件',
        mime: item.mime || record.mime || 'application/octet-stream',
        size: Number(item.size || record.size || 0),
        encoding: 'base64',
        data_base64: base64Bytes(record.data),
      });
    } catch (error) {
      output.push({
        id: item.id,
        conversation_id: item.conversation_id,
        name: item.name || '附件',
        unavailable: true,
        error: String(error?.type || error?.message || 'attachment_read_failed').slice(0, 160),
      });
    }
  }
  return output;
}

async function tableRows(db, tableName, { limit = 10000 } = {}) {
  const allowed = new Set(['coast_tool_runs', 'coast_dev_runs', 'coast_update_records']);
  if (!allowed.has(tableName)) return [];
  const output = [];
  const pageSize = 500;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const result = await db.prepare(`SELECT * FROM ${tableName} ORDER BY rowid ASC LIMIT ? OFFSET ?`)
      .bind(Math.min(pageSize, limit - offset), offset)
      .all();
    const rows = result?.results || [];
    output.push(...rows);
    if (rows.length < pageSize) break;
  }
  return output;
}

async function buildFullArchive(env) {
  const db = env.COAST_CHAT_DB;
  const [snapshot, modelEchoes] = await Promise.all([
    buildSnapshot(env),
    listAllMessageModelMetadata(db, { includeRaw: true, limit: 10000 }),
  ]);
  const [attachmentPayloads, toolRunsAll, devRunsAll, updateRecordsAll] = await Promise.all([
    fullAttachmentPayloads(db, snapshot),
    tableRows(db, 'coast_tool_runs'),
    tableRows(db, 'coast_dev_runs'),
    tableRows(db, 'coast_update_records'),
  ]);
  const archive = {
    ...snapshot,
    format: 'elementera-coast-full-archive',
    version: 1,
    archive_note: 'This package contains everything Coast currently stores and can safely export. Provider-returned reasoning/model echo fields are included when they were actually returned; hidden or unavailable chain-of-thought is not fabricated.',
    included_modules: [
      ...(Array.isArray(snapshot.included_modules) ? snapshot.included_modules : []),
      'model_echo_and_reasoning_metadata',
      'attachment_binary_payloads',
      'full_tool_run_storage',
      'full_dev_hand_run_storage',
      'full_update_record_storage',
    ].filter((item, index, list) => list.indexOf(item) === index),
    excluded_modules: (Array.isArray(snapshot.excluded_modules) ? snapshot.excluded_modules : [])
      .filter((item) => item !== 'attachment_binary_payloads'),
    model_echoes: modelEchoes,
    attachments: {
      ...(snapshot.attachments || {}),
      binary_included: true,
      payloads: attachmentPayloads,
    },
    storage_records: {
      tool_runs: toolRunsAll,
      dev_hand_runs: devRunsAll,
      update_records: updateRecordsAll,
    },
  };
  return redactSnapshot(archive);
}

export function isSnapshotApiPath(pathname) {
  return pathname === SNAPSHOT_PATH || pathname === FULL_ARCHIVE_PATH;
}

export async function routeSnapshotApi(request, env) {
  const pathname = new URL(request.url).pathname;
  if (![SNAPSHOT_PATH, FULL_ARCHIVE_PATH].includes(pathname)) return apiError('not_found', 'Not found.', 404);
  if (request.method !== 'GET') return methodNotAllowed('GET');
  try {
    if (pathname === FULL_ARCHIVE_PATH) return json({ ok: true, archive: await buildFullArchive(env) });
    return json({ ok: true, snapshot: await buildSnapshot(env) });
  } catch (error) {
    return apiError(
      'snapshot_export_failed',
      pathname === FULL_ARCHIVE_PATH ? '完整导出包生成失败。' : 'V1 防丢快照生成失败。',
      500,
      { reason: String(error?.type || error?.message || 'snapshot_export_failed').slice(0, 160) },
    );
  }
}

export { buildSnapshot, buildFullArchive, redactSnapshot };
