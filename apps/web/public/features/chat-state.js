import { clamp, id, sanitizeId } from '../core/dom.js';

const MAX_ERROR_DETAIL = 12000;
const MAX_TURNS = 400;
const MAX_VARIANTS = 20;
const MAX_DESK_SLIP_JSON = 256000;
const GENERATION_SOURCES = new Set(['chat', 'landing', 'relay', 'bridge', 'other']);
const MESSAGE_SOURCES = new Set(['owner_web', 'official_mcp', 'external']);

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

function normalizeToolRuns(value) {
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
  const humanThoughtSnapshotId = value.human_thought_snapshot_id
    ? sanitizeId(value.human_thought_snapshot_id, 'human_thought_snapshot')
    : '';
  const messageSource = MESSAGE_SOURCES.has(value.message_source) ? value.message_source : '';
  const displayAuthor = String(value.display_author || '').trim().slice(0, 180);
  const sourceModelLabel = String(value.source_model_label || '').trim().slice(0, 180);
  const toolRuns = normalizeToolRuns(value.tool_runs);
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
    ...(humanThoughtSnapshotId ? { human_thought_snapshot_id: humanThoughtSnapshotId } : {}),
    ...(messageSource ? { message_source: messageSource } : {}),
    ...(displayAuthor ? { display_author: displayAuthor } : {}),
    ...(sourceModelLabel ? { source_model_label: sourceModelLabel } : {}),
    ...(toolRuns.length ? { tool_runs: toolRuns } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(deskSlip ? { desk_slip: deskSlip } : {}),
    ...(errorDetail ? { errorDetail } : {}),
  };
}

export function normalizeTurn(value = {}) {
  const ownerVariants = (Array.isArray(value?.owner?.variants) ? value.owner.variants : [])
    .map((variant) => normalizeVariant(variant, 'owner'))
    .filter(Boolean)
    .slice(0, MAX_VARIANTS);
  const branches = {};
  const active = {};
  for (let index = 0; index < Math.max(1, ownerVariants.length); index += 1) {
    const key = String(index);
    branches[key] = (Array.isArray(value?.model_partner?.variantsByOwnerVariant?.[key])
      ? value.model_partner.variantsByOwnerVariant[key]
      : [])
      .map((variant) => normalizeVariant(variant, 'model_partner'))
      .filter(Boolean)
      .slice(0, MAX_VARIANTS);
    active[key] = clamp(value?.model_partner?.activeByOwnerVariant?.[key], branches[key].length || 1);
  }
  const turnType = value.turn_type === 'landing' ? 'landing' : '';
  return {
    id: sanitizeId(value.id || id('turn'), 'turn'),
    ...(turnType ? { turn_type: turnType, model_id: String(value.model_id || '').slice(0, 180) } : {}),
    owner: {
      active: clamp(value?.owner?.active, ownerVariants.length || 1),
      variants: ownerVariants,
    },
    model_partner: {
      activeByOwnerVariant: active,
      variantsByOwnerVariant: branches,
    },
  };
}

function keepCurrentDeskSlip(turns) {
  let current = null;
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const ownerIndex = clamp(turn?.owner?.active, turn?.owner?.variants?.length || 1);
    const key = String(ownerIndex);
    const modelPartners = turn?.model_partner?.variantsByOwnerVariant?.[key] || [];
    if (!modelPartners.length) continue;
    const modelPartnerIndex = clamp(turn?.model_partner?.activeByOwnerVariant?.[key], modelPartners.length || 1);
    current = modelPartners[modelPartnerIndex] || null;
    break;
  }
  for (const turn of turns) {
    for (const modelPartners of Object.values(turn?.model_partner?.variantsByOwnerVariant || {})) {
      for (const variant of modelPartners) {
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
    .filter((turn) => turn.owner.variants.length || Object.values(turn.model_partner.variantsByOwnerVariant).some((list) => list.length))
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
  const ownerIndex = clamp(turn?.owner?.active, turn?.owner?.variants?.length || 1);
  const key = String(ownerIndex);
  const modelPartners = turn?.model_partner?.variantsByOwnerVariant?.[key] || [];
  const modelPartnerIndex = clamp(turn?.model_partner?.activeByOwnerVariant?.[key], modelPartners.length || 1);
  return {
    ownerIndex,
    key,
    owner: turn?.owner?.variants?.[ownerIndex] || null,
    modelPartners,
    modelPartnerIndex,
    modelPartner: modelPartners[modelPartnerIndex] || null,
  };
}

export function activeMessages(value) {
  const result = [];
  for (const turn of normalizeState(value).turns) {
    const branch = activeBranch(turn);
    if (branch.owner?.content) result.push({ role: 'user', ...branch.owner });
    if (branch.modelPartner?.content) result.push({ role: 'assistant', ...branch.modelPartner });
  }
  return result;
}

export function appendTurn(value, content, metadata = {}) {
  const state = normalizeState(value);
  const turn = normalizeTurn({
    owner: {
      active: 0,
      variants: [{
        content: String(content || '').trim(),
        human_thought_snapshot_id: metadata.human_thought_snapshot_id,
        message_source: metadata.message_source,
        display_author: metadata.display_author,
        source_model_label: metadata.source_model_label,
        attachments: metadata.attachments,
      }],
    },
    model_partner: { activeByOwnerVariant: { 0: 0 }, variantsByOwnerVariant: { 0: [] } },
  });
  state.turns.push(turn);
  state.turns = state.turns.slice(-MAX_TURNS);
  state.updated_at = now();
  return { state, turn };
}

export function editOwnerVariant(value, turnId, content) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return { state, turn: null };
  const current = activeBranch(turn).owner;
  const variant = normalizeVariant({
    content: String(content ?? ''),
    attachments: current?.attachments || [],
    message_source: current?.message_source,
    display_author: current?.display_author,
    human_thought_snapshot_id: current?.human_thought_snapshot_id,
  }, 'owner');
  turn.owner.variants.push(variant);
  turn.owner.variants = turn.owner.variants.slice(-MAX_VARIANTS);
  const ownerIndex = turn.owner.variants.length - 1;
  turn.owner.active = ownerIndex;
  turn.model_partner.variantsByOwnerVariant[String(ownerIndex)] = [];
  turn.model_partner.activeByOwnerVariant[String(ownerIndex)] = 0;
  state.updated_at = now();
  return { state, turn };
}

export function deleteActiveOwnerVariant(value, turnId) {
  const state = normalizeState(value);
  const turnIndex = state.turns.findIndex((item) => item.id === turnId);
  const turn = state.turns[turnIndex];
  if (!turn) return state;
  const removedIndex = clamp(turn.owner.active, turn.owner.variants.length || 1);
  turn.owner.variants.splice(removedIndex, 1);
  if (!turn.owner.variants.length) {
    state.turns.splice(turnIndex, 1);
    state.updated_at = now();
    return state;
  }

  const branches = {};
  const active = {};
  for (let index = 0; index < turn.owner.variants.length; index += 1) {
    const oldIndex = index >= removedIndex ? index + 1 : index;
    const list = turn.model_partner.variantsByOwnerVariant[String(oldIndex)] || [];
    branches[String(index)] = list;
    active[String(index)] = clamp(turn.model_partner.activeByOwnerVariant[String(oldIndex)], list.length || 1);
  }
  turn.owner.active = Math.min(removedIndex, turn.owner.variants.length - 1);
  turn.model_partner.variantsByOwnerVariant = branches;
  turn.model_partner.activeByOwnerVariant = active;
  state.updated_at = now();
  return state;
}

export function appendModelPartnerVariant(value, turnId, variantValue) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return { state, turn: null, variant: null, modelPartnerIndex: -1, ownerIndex: -1 };
  const branch = activeBranch(turn);
  const variant = normalizeVariant(variantValue, 'model_partner');
  const list = turn.model_partner.variantsByOwnerVariant[branch.key] || [];
  list.push(variant);
  turn.model_partner.variantsByOwnerVariant[branch.key] = list.slice(-MAX_VARIANTS);
  const modelPartnerIndex = turn.model_partner.variantsByOwnerVariant[branch.key].length - 1;
  turn.model_partner.activeByOwnerVariant[branch.key] = modelPartnerIndex;
  state.updated_at = now();
  return { state, turn, variant, modelPartnerIndex, ownerIndex: branch.ownerIndex };
}

export function updateModelPartnerVariant(value, turnId, ownerIndex, modelPartnerIndex, patch) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  const variant = turn?.model_partner?.variantsByOwnerVariant?.[String(ownerIndex)]?.[modelPartnerIndex];
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
  if ('tool_runs' in patch) {
    const toolRuns = normalizeToolRuns(patch.tool_runs);
    if (toolRuns.length) variant.tool_runs = toolRuns;
    else delete variant.tool_runs;
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

export function deleteActiveModelPartnerVariant(value, turnId) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return state;
  const branch = activeBranch(turn);
  if (!branch.modelPartners.length) return state;
  branch.modelPartners.splice(branch.modelPartnerIndex, 1);
  turn.model_partner.activeByOwnerVariant[branch.key] = Math.min(branch.modelPartnerIndex, Math.max(0, branch.modelPartners.length - 1));
  state.updated_at = now();
  return state;
}

export function switchVariant(value, turnId, kind, direction) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn) return state;
  const delta = direction === 'next' ? 1 : -1;
  if (kind === 'owner' && turn.owner.variants.length > 1) {
    turn.owner.active = (turn.owner.active + delta + turn.owner.variants.length) % turn.owner.variants.length;
  }
  if (kind === 'model_partner') {
    const branch = activeBranch(turn);
    if (branch.modelPartners.length > 1) {
      turn.model_partner.activeByOwnerVariant[branch.key] = (branch.modelPartnerIndex + delta + branch.modelPartners.length) % branch.modelPartners.length;
    }
  }
  state.updated_at = now();
  return state;
}

export function toggleModelPartnerReaction(value, turnId, reaction) {
  const state = normalizeState(value);
  const turn = state.turns.find((item) => item.id === turnId);
  if (!turn || !['liked', 'favorite'].includes(reaction)) return state;
  const branch = activeBranch(turn);
  if (!branch.modelPartner) return state;
  branch.modelPartner[reaction] = !branch.modelPartner[reaction];
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
      state = appendModelPartnerVariant(state, turn.id, message).state;
    }
  }
  return normalizeState(state);
}
