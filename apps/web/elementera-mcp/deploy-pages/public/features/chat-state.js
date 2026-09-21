import { clamp, id, sanitizeId } from '../core/dom.js';

const MAX_ERROR_DETAIL = 12000;
const MAX_TURNS = 400;
const MAX_VARIANTS = 20;
const MAX_DESK_SLIP_JSON = 256000;
const GENERATION_SOURCES = new Set(['chat', 'landing', 'relay', 'radio', 'lighthouse', 'other']);
const MESSAGE_SOURCES = new Set(['xiaohan_web', 'official_mcp', 'rikkahub']);

const now = () => new Date().toISOString();

function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
  const values = fields.map((field) => Number(value[field]));
  if (!values.every((number) => Number.isFinite(number) && number >= 0)) return null;
  return Object.fromEntries(fields.map((field, index) => [field, Math.trunc(values[index])]));
}

function normalizeDeskSlip(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length > MAX_DESK_SLIP_JSON) return null;
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function normalizeAttachments(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item) => {
    const idValue = sanitizeId(item?.id || '', 'attachment');
    const type = item?.type === 'image' ? 'image' : 'file';
    const name = String(item?.name || '附件').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 180);
    const mime = String(item?.mime || 'application/octet-stream').trim().slice(0, 120);
    const size = Math.max(0, Math.trunc(Number(item?.size) || 0));
    const storageKey = String(item?.storage_key || '').trim().slice(0, 220);
    const createdAt = typeof item?.created_at === 'string' ? item.created_at : now();
    if (!item?.id || !name || !storageKey) return null;
    return {
      id: idValue,
      type,
      name,
      mime,
      size,
      storage_key: storageKey,
      created_at: createdAt,
    };
  }).filter(Boolean);
}

function normalizeFurnitureRuns(value) {
  return (Array.isArray(value) ? value : []).slice(0, 16).map((run) => {
    const idValue = sanitizeId(run?.id || '', 'tool_run');
    const toolKey = String(run?.tool_key || '').trim().slice(0, 120);
    const label = String(run?.label || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!run?.id || !toolKey || !label) return null;
    const status = run?.status === 'error' ? 'error' : 'success';
    const items = (Array.isArray(run?.items) ? run.items : []).slice(0, 5).map((item) => ({ title: String(item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 100), kind: String(item?.kind || '').replace(/\s+/g, ' ').trim().slice(0, 40) })).filter((item) => item.title);
    return { id: idValue, tool_key: toolKey, label, status, count: Math.max(1, Math.trunc(Number(run?.count) || 1)), items, extra_count: Math.max(0, Math.trunc(Number(run?.extra_count) || 0)), ...(status === 'error' ? { error_type: String(run?.error_type || 'tool_execution_failed').slice(0, 120) } : {}) };
  }).filter(Boolean);
}

export function normalizeVariant(value = {}, prefix = 'variant') {
  if (typeof value.content !== 'string') return null;
  const errorDetail = String(value.errorDetail || '').trim().slice(0, MAX_ERROR_DETAIL);
  const finishReason = String(value.finish_reason || '').trim().slice(0, 80);
  const modelId = String(value.model_id || '').trim().slice(0, 180);
  const usage = normalizeUsage(value.usage);
  const generationSource = GENERATION_SOURCES.has(value.generation_source) ? value.generation_source : '';
  const dogtalkSnapshotId = value.dogtalk_snapshot_id
    ? sanitizeId(value.dogtalk_snapshot_id, 'dogtalk_snapshot')
    : '';
  const messageSource = MESSAGE_SOURCES.has(value.message_source) ? value.message_source : '';
  const displayAuthor = String(value.display_author || '').trim().slice(0, 180);
  const sourceModelLabel = String(value.source_model_label || '').trim().slice(0, 180);
  const furnitureRuns = normalizeFurnitureRuns(value.furniture_runs);
  const attachments = normalizeAttachments(value.attachments);
  const deskSlip = normalizeDeskSlip(value.desk_slip);
  return {
    id: sanitizeId(value.id || id(prefix), prefix),
    content: value.content,
    created_at: typeof value.created_at === 'string' ? value.created_at : now(),
    liked: Boolean(value.liked),
    favorite: Boolean(value.favorite),
    ...(value.hidden === true ? { hidden: true } : {}),
    ...(value.input_type === 'landing_letter' ? { input_type: 'landing_letter' } : {}),
    ...(modelId ? { model_id: modelId } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finish_reason: finishReason } : {}),
    ...(generationSource ? { generation_source: generationSource } : {}),
    ...(dogtalkSnapshotId ? { dogtalk_snapshot_id: dogtalkSnapshotId } : {}),
    ...(messageSource ? { message_source: messageSource } : {}),
    ...(displayAuthor ? { display_author: displayAuthor } : {}),
    ...(sourceModelLabel ? { source_model_label: sourceModelLabel } : {}),
    ...(furnitureRuns.length ? { furniture_runs: furnitureRuns } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(deskSlip ? { desk_slip: deskSlip } : {}),
    ...(errorDetail ? { errorDetail } : {}),
  };
}

export function normalizeTurn(value = {}) {
  const userVariants = (Array.isArray(value?.user?.variants) ? value.user.variants : [])
    .map((variant) => normalizeVariant(variant, 'user'))
    .filter(Boolean)
    .slice(0, MAX_VARIANTS);
  const branches = {};
  const active = {};
  for (let index = 0; index < Math.max(1, userVariants.length); index += 1) {
    const key = String(index);
    branches[key] = (Array.isArray(value?.assistant?.variantsByUserVariant?.[key])
      ? value.assistant.variantsByUserVariant[key]
      : [])
      .map((variant) => normalizeVariant(variant, 'assistant'))
      .filter(Boolean)
      .slice(0, MAX_VARIANTS);
    active[key] = clamp(value?.assistant?.activeByUserVariant?.[key], branches[key].length || 1);
  }
  const turnType = value.turn_type === 'landing' ? 'landing' : '';
  return {
    id: sanitizeId(value.id || id('turn'), 'turn'),
    ...(turnType ? { turn_type: turnType, model_id: String(value.model_id || '').slice(0, 180) } : {}),
    user: {
      active: clamp(value?.user?.active, userVariants.length || 1),
      variants: userVariants,
    },
    assistant: {
      activeByUserVariant: active,
      variantsByUserVariant: branches,
    },
  };
}

function keepCurrentDeskSlip(turns) {
  let current = null;
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const userIndex = clamp(turn?.user?.active, turn?.user?.variants?.length || 1);
    const key = String(userIndex);
    const assistants = turn?.assistant?.variantsByUserVariant?.[key] || [];
    if (!assistants.length) continue;
    const assistantIndex = clamp(turn?.assistant?.activeByUserVariant?.[key], assistants.length || 1);
    current = assistants[assistantIndex] || null;
    break;
  }
  for (const turn of turns) {
    for (const assistants of Object.values(turn?.assistant?.variantsByUserVariant || {})) {
      for (const variant of assistants) {
        if (variant !== current) delete variant.desk_slip;
      }
    }
  }
  return turns;
}

export function normalizeState(value = {}) {
  const raw = value?.history || value || {};
  const turns = (Array.isArray(raw.turns) ? raw.turns : [])
    .map(normalizeTurn)
    .filter((turn) => turn.user.variants.length || Object.values(turn.assistant.variantsByUserVariant).some((list) => list.length))
    .slice(-MAX_TURNS);
  keepCurrentDeskSlip(turns);
  return {
    version: 4,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : now(),
    turns,
  };
}

export function createState() {
  return normalizeState();
}

export function activeBranch(turn) {
  const userIndex = clamp(turn?.user?.active, turn?.user?.variants?.length || 1);
  const key = String(userIndex);
  const assistants = turn?.assistant?.variantsByUserVariant?.[key] || [];
  const assistantIndex = clamp(turn?.assistant?.activeByUserVariant?.[key], assistants.length || 1);
  return {
    userIndex,
    key,
    user: turn?.user?.variants?.[userIndex] || null,
    assistants,
    assistantIndex,
    assistant: assistants[assistantIndex] || null,
  };
}

export function activeMessages(value) {
  const result = [];
  for (const turn of normalizeState(value).turns) {
    const branch = activeBranch(turn);
    if (branch.user?.content) result.push({ role: 'user', ...branch.user });
    if (branch.assistant?.content) result.push({ role: 'assistant', ...branch.assistant });
  }
  return result;
}

export function appendTurn(value, content, metadata = {}) {
  const state = normalizeState(value);
  const turn = normalizeTurn({
    user: {
      active: 0,
      variants: [{
        content: String(content || '').trim(),
        dogtalk_snapshot_id: metadata.dogtalk_snapshot_id,
        message_source: metadata.message_source,
        display_author: metadata.display_author,
        source_model_label: metadata.source_model_label,
        attachments: metadata.attachments,
      }],
    },
    assistant: { activeByUserVariant: { 0: 0 }, variantsByUserVariant: { 0: [] } },
  });
  state.turns.push(turn);
  state.turns = state.turns.slice(-MAX_TURNS);
  state.updated_at = now();
  return { state, turn };
}

export function editUserVariant(value, turnId, content) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return { state, turn: null };
  const current = activeBranch(turn).user;
  const variant = normalizeVariant({
    content: String(content ?? ''),
    attachments: current?.attachments || [],
    message_source: current?.message_source,
    display_author: current?.display_author,
    dogtalk_snapshot_id: current?.dogtalk_snapshot_id,
  }, 'user');
  turn.user.variants.push(variant);
  turn.user.variants = turn.user.variants.slice(-MAX_VARIANTS);
  const userIndex = turn.user.variants.length - 1;
  turn.user.active = userIndex;
  turn.assistant.variantsByUserVariant[String(userIndex)] = [];
  turn.assistant.activeByUserVariant[String(userIndex)] = 0;
  state.updated_at = now();
  return { state, turn };
}

export function deleteActiveUserVariant(value, turnId) {
  const state = normalizeState(value);
  const turnIndex = state.turns.findIndex((item) => item.id === turnId);
  const turn = state.turns[turnIndex];
  if (!turn) return state;
  const removedIndex = clamp(turn.user.active, turn.user.variants.length || 1);
  turn.user.variants.splice(removedIndex, 1);
  if (!turn.user.variants.length) {
    state.turns.splice(turnIndex, 1);
    state.updated_at = now();
    return state;
  }

  const branches = {};
  const active = {};
  for (let index = 0; index < turn.user.variants.length; index += 1) {
    const oldIndex = index >= removedIndex ? index + 1 : index;
    const list = turn.assistant.variantsByUserVariant[String(oldIndex)] || [];
    branches[String(index)] = list;
    active[String(index)] = clamp(turn.assistant.activeByUserVariant[String(oldIndex)], list.length || 1);
  }
  turn.user.active = Math.min(removedIndex, turn.user.variants.length - 1);
  turn.assistant.variantsByUserVariant = branches;
  turn.assistant.activeByUserVariant = active;
  state.updated_at = now();
  return state;
}

export function appendAssistantVariant(value, turnId, variantValue) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return { state, turn: null, variant: null, assistantIndex: -1, userIndex: -1 };
  const branch = activeBranch(turn);
  const variant = normalizeVariant(variantValue, 'assistant');
  const list = turn.assistant.variantsByUserVariant[branch.key] || [];
  list.push(variant);
  turn.assistant.variantsByUserVariant[branch.key] = list.slice(-MAX_VARIANTS);
  const assistantIndex = turn.assistant.variantsByUserVariant[branch.key].length - 1;
  turn.assistant.activeByUserVariant[branch.key] = assistantIndex;
  state.updated_at = now();
  return { state, turn, variant, assistantIndex, userIndex: branch.userIndex };
}

export function updateAssistantVariant(value, turnId, userIndex, assistantIndex, patch) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  const variant = turn?.assistant?.variantsByUserVariant?.[String(userIndex)]?.[assistantIndex];
  if (!variant) return state;
  if (typeof patch.content === 'string') variant.content = patch.content;
  if ('errorDetail' in patch) {
    const errorDetail = String(patch.errorDetail || '').trim().slice(0, MAX_ERROR_DETAIL);
    if (errorDetail) variant.errorDetail = errorDetail;
    else delete variant.errorDetail;
  }
  if ('liked' in patch) variant.liked = Boolean(patch.liked);
  if ('favorite' in patch) variant.favorite = Boolean(patch.favorite);
  if ('model_id' in patch) {
    const modelId = String(patch.model_id || '').trim().slice(0, 180);
    if (modelId) variant.model_id = modelId;
    else delete variant.model_id;
  }
  if ('usage' in patch) {
    const usage = normalizeUsage(patch.usage);
    if (usage) variant.usage = usage;
    else delete variant.usage;
  }
  if ('finish_reason' in patch) {
    const finishReason = String(patch.finish_reason || '').trim().slice(0, 80);
    if (finishReason) variant.finish_reason = finishReason;
    else delete variant.finish_reason;
  }
  if ('generation_source' in patch) {
    if (GENERATION_SOURCES.has(patch.generation_source)) variant.generation_source = patch.generation_source;
    else delete variant.generation_source;
  }
  if ('furniture_runs' in patch) {
    const furnitureRuns = normalizeFurnitureRuns(patch.furniture_runs);
    if (furnitureRuns.length) variant.furniture_runs = furnitureRuns;
    else delete variant.furniture_runs;
  }
  if ('desk_slip' in patch) {
    const deskSlip = normalizeDeskSlip(patch.desk_slip);
    if (deskSlip) variant.desk_slip = deskSlip;
    else delete variant.desk_slip;
  }
  keepCurrentDeskSlip(state.turns);
  state.updated_at = now();
  return state;
}

export function deleteActiveAssistantVariant(value, turnId) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return state;
  const branch = activeBranch(turn);
  if (!branch.assistants.length) return state;
  branch.assistants.splice(branch.assistantIndex, 1);
  turn.assistant.activeByUserVariant[branch.key] = Math.min(branch.assistantIndex, Math.max(0, branch.assistants.length - 1));
  state.updated_at = now();
  return state;
}

export function switchVariant(value, turnId, kind, direction) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return state;
  const delta = direction === 'next' ? 1 : -1;
  if (kind === 'user' && turn.user.variants.length > 1) {
    turn.user.active = (turn.user.active + delta + turn.user.variants.length) % turn.user.variants.length;
  }
  if (kind === 'assistant') {
    const branch = activeBranch(turn);
    if (branch.assistants.length > 1) {
      turn.assistant.activeByUserVariant[branch.key] = (branch.assistantIndex + delta + branch.assistants.length) % branch.assistants.length;
    }
  }
  state.updated_at = now();
  return state;
}

export function toggleAssistantReaction(value, turnId, reaction) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn || !['liked', 'favorite'].includes(reaction)) return state;
  const branch = activeBranch(turn);
  if (!branch.assistant) return state;
  branch.assistant[reaction] = !branch.assistant[reaction];
  state.updated_at = now();
  return state;
}

export function flatMessagesToState(messages = []) {
  let state = createState();
  let turn = null;
  for (const message of Array.isArray(messages) ? messages.slice(-200) : []) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue;
    if (message.role === 'user') {
      const appended = appendTurn(state, message.content);
      state = appended.state;
      turn = appended.turn;
    } else if (turn) {
      state = appendAssistantVariant(state, turn.id, message).state;
    }
  }
  return normalizeState(state);
}
