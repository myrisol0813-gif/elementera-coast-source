import {
  createPassphraseHash,
  normalizePassphrase,
  passphraseLookup,
  verifyPassphraseHash,
} from './mailbox-auth.js';
import {
  archiveVisibleNotebookEntry,
  claimMailboxPatrol,
  completeMailboxPatrol,
  createMailboxVisitor,
  deleteMailboxMessage,
  deleteMailboxVisitorAccount,
  editVisitorMailboxMessage,
  findMailboxVisitorByLookup,
  getMailboxVisitor,
  listMailboxMessages,
  listMailboxMemoryPockets,
  listOwnerMailboxVisitors,
  listVisitorNotebook,
  mailboxStatusForVisitor,
  MailboxRepositoryError,
  ownerMailboxSummary,
  readMailboxThoughtSoil,
  resolveMailboxMemoryPocket,
  touchMailboxVisitor,
  writeMailboxReply,
  writeVisitorMailboxMessage,
} from './mailbox-repository.js';

export class MailboxServiceError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'MailboxServiceError';
    this.type = type;
    this.status = status;
  }
}

function invalid(message) {
  throw new MailboxServiceError('invalid_mailbox_input', message, 400);
}

function text(value, name, max, { required = false } = {}) {
  if (value == null) {
    if (required) invalid(`${name}不能为空。`);
    return '';
  }
  if (typeof value !== 'string') invalid(`${name}必须是文字。`);
  const result = value.trim();
  if (required && !result) invalid(`${name}不能为空。`);
  if (result.length > max) invalid(`${name}过长。`);
  return result;
}

function boolean(value, name, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') invalid(`${name}必须是布尔值。`);
  return value;
}

function array(value, name, max) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) invalid(`${name}格式无效。`);
  return value;
}

function activeVisitor(visitor) {
  if (!visitor?.is_active) {
    throw new MailboxServiceError('mailbox_session_invalid', '访客暗号已失效，请重新进入。', 401);
  }
  return visitor;
}

export async function registerMailboxVisitor(db, env, input = {}) {
  const displayName = text(input.display_name, '称呼', 80, { required: true });
  const preferredName = text(input.preferred_name, '希望模型伙伴使用的称呼', 80);
  const passphrase = normalizePassphrase(input.passphrase);
  if (!passphrase) invalid('暗号不能为空。');
  if (passphrase.length > 160) invalid('暗号过长。');
  const allowMemory = boolean(input.allow_memory, 'allow_memory', true);
  const lookup = await passphraseLookup(passphrase, env);
  if (await findMailboxVisitorByLookup(db, lookup)) {
    throw new MailboxServiceError(
      'mailbox_passphrase_exists',
      '这个暗号已经被登记过。',
      409,
    );
  }
  try {
    return await createMailboxVisitor(db, {
      display_name: displayName,
      preferred_name: preferredName || null,
      passphrase_hash: await createPassphraseHash(passphrase, env),
      passphrase_lookup: lookup,
      allow_memory: allowMemory,
    });
  } catch (error) {
    if (/UNIQUE constraint failed: mailbox_visitors\.(?:passphrase_lookup|passphrase_hash)/.test(String(error?.message || ''))) {
      throw new MailboxServiceError(
        'mailbox_passphrase_exists',
        '这个暗号已经被登记过。',
        409,
      );
    }
    throw error;
  }
}

export async function loginMailboxVisitor(db, env, passphraseValue) {
  const passphrase = normalizePassphrase(passphraseValue);
  if (!passphrase) invalid('暗号不能为空。');
  if (passphrase.length > 160) invalid('暗号过长。');
  const record = await findMailboxVisitorByLookup(db, await passphraseLookup(passphrase, env));
  if (!record
    || !record.visitor.is_active
    || !(await verifyPassphraseHash(passphrase, record.passphrase_hash, env))) {
    throw new MailboxServiceError(
      'mailbox_passphrase_invalid',
      '暗号没有登记，或输入得不对。',
      401,
    );
  }
  return activeVisitor(await touchMailboxVisitor(db, record.visitor.id));
}

export async function currentMailboxVisitor(db, visitorId, { touch = false } = {}) {
  const visitor = touch
    ? await touchMailboxVisitor(db, visitorId)
    : await getMailboxVisitor(db, visitorId);
  return activeVisitor(visitor);
}

export async function mailboxMessages(db, visitorId) {
  await currentMailboxVisitor(db, visitorId);
  return listMailboxMessages(db, visitorId);
}

export async function sendMailboxMessage(db, visitorId, value) {
  await currentMailboxVisitor(db, visitorId);
  const content = text(value, '来信正文', 40000, { required: true });
  return writeVisitorMailboxMessage(db, visitorId, content);
}

export async function editMailboxMessage(db, visitorId, messageIdValue, value) {
  await currentMailboxVisitor(db, visitorId);
  const messageId = text(messageIdValue, '消息编号', 240, { required: true });
  const content = text(value, '来信正文', 40000, { required: true });
  try {
    return await editVisitorMailboxMessage(db, visitorId, messageId, content);
  } catch (error) {
    if (error instanceof MailboxRepositoryError) {
      throw new MailboxServiceError(error.type, error.message, error.status);
    }
    throw error;
  }
}

export async function removeMailboxMessage(db, visitorId, messageIdValue) {
  await currentMailboxVisitor(db, visitorId);
  const messageId = text(messageIdValue, '消息编号', 240, { required: true });
  try {
    return await deleteMailboxMessage(db, visitorId, messageId);
  } catch (error) {
    if (error instanceof MailboxRepositoryError) {
      throw new MailboxServiceError(error.type, error.message, error.status);
    }
    throw error;
  }
}

export async function removeMailboxAccount(db, visitorId) {
  await currentMailboxVisitor(db, visitorId);
  try {
    return await deleteMailboxVisitorAccount(db, visitorId);
  } catch (error) {
    if (error instanceof MailboxRepositoryError) {
      throw new MailboxServiceError(error.type, error.message, error.status);
    }
    throw error;
  }
}

export async function mailboxVisitorStatus(db, visitorId) {
  await currentMailboxVisitor(db, visitorId);
  return mailboxStatusForVisitor(db, visitorId);
}

export async function visibleVisitorMemory(db, visitorId) {
  const visitor = await currentMailboxVisitor(db, visitorId);
  const [thoughtSoil, pendingPockets, entries] = await Promise.all([
    readMailboxThoughtSoil(db, visitorId),
    visitor.allow_memory ? listMailboxMemoryPockets(db, visitorId) : [],
    visitor.allow_memory
      ? listVisitorNotebook(db, visitorId, { visitorVisibleOnly: true })
      : [],
  ]);
  return {
    thought_soil: thoughtSoil,
    pending_pockets: pendingPockets,
    entries,
  };
}

export async function deleteVisibleVisitorNotebookEntry(db, visitorId, entryIdValue) {
  await currentMailboxVisitor(db, visitorId);
  const entryId = text(entryIdValue, '记事编号', 200, { required: true });
  if (!(await archiveVisibleNotebookEntry(db, visitorId, entryId))) {
    throw new MailboxServiceError('visitor_notebook_not_found', '这张访客记事不存在。', 404);
  }
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${name}格式无效。`);
  }
  return value;
}

function handSeeds(value) {
  return array(value, 'thought_soil.hand_seeds', 7).map((raw, index) => {
    const item = record(raw, `thought_soil.hand_seeds[${index}]`);
    const lifeCore = text(
      item.life_core ?? item.name,
      `thought_soil.hand_seeds[${index}].life_core`,
      1200,
      { required: true },
    );
    return {
      name: text(item.name, `thought_soil.hand_seeds[${index}].name`, 160) || lifeCore.slice(0, 160),
      life_core: lifeCore,
      usage_hint: text(item.usage_hint, `thought_soil.hand_seeds[${index}].usage_hint`, 1200),
      avoid_hint: text(item.avoid_hint, `thought_soil.hand_seeds[${index}].avoid_hint`, 1200),
    };
  });
}

function pocketCandidates(value) {
  return array(value, 'thought_soil.pocket_candidates', 7).map((raw, index) => {
    const item = record(raw, `thought_soil.pocket_candidates[${index}]`);
    const lifeCore = text(
      item.life_core ?? item.title ?? item.content,
      `thought_soil.pocket_candidates[${index}].life_core`,
      2000,
      { required: true },
    );
    const title = text(
      item.title,
      `thought_soil.pocket_candidates[${index}].title`,
      160,
    ) || lifeCore.slice(0, 160);
    return {
      title,
      life_core: lifeCore,
      content: text(
        item.content,
        `thought_soil.pocket_candidates[${index}].content`,
        8000,
      ) || lifeCore,
      usage_hint: text(item.usage_hint, `thought_soil.pocket_candidates[${index}].usage_hint`, 2000),
      avoid_hint: text(item.avoid_hint, `thought_soil.pocket_candidates[${index}].avoid_hint`, 2000),
      source_excerpt: text(item.source_excerpt, `thought_soil.pocket_candidates[${index}].source_excerpt`, 2000),
    };
  });
}

function thoughtSoil(value) {
  const soil = record(value, 'thought_soil');
  return {
    current_text: text(soil.current_text, 'thought_soil.current_text', 4000),
    hand_seeds: handSeeds(soil.hand_seeds),
    do_not_repeat: text(soil.do_not_repeat, 'thought_soil.do_not_repeat', 4000),
    pocket_candidates: pocketCandidates(soil.pocket_candidates),
  };
}

export async function fetchUnrepliedMailbox(db, input = {}) {
  const requestedLimit = input.message_limit == null ? 60 : Number(input.message_limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 10 || requestedLimit > 100) {
    invalid('message_limit 超出允许范围。');
  }
  return claimMailboxPatrol(db, { messageLimit: requestedLimit });
}

export async function replyToMailboxVisitor(db, input = {}) {
  const needsOwnerAttention = boolean(
    input.needs_owner_attention,
    'needs_owner_attention',
    false,
  );
  const ownerAttentionReason = needsOwnerAttention
    ? text(input.owner_attention_reason, 'owner_attention_reason', 500, { required: true })
    : '';
  try {
    return await writeMailboxReply(db, {
      batch_id: text(input.batch_id, 'batch_id', 200, { required: true }),
      queue_id: text(input.queue_id, 'queue_id', 240, { required: true }),
      visitor_id: text(input.visitor_id, 'visitor_id', 240, { required: true }),
      content: text(input.content, '回信正文', 40000, { required: true }),
      thought_soil: thoughtSoil(input.thought_soil),
      model_label: text(input.model_label, 'model_label', 120, { required: true }),
      model_nickname: text(input.model_nickname, 'model_nickname', 60),
      source_conversation_id: text(input.source_conversation_id, 'source_conversation_id', 200),
      source_turn_id: text(input.source_turn_id, 'source_turn_id', 200),
      tool_call_id: text(input.tool_call_id, 'tool_call_id', 240),
      needs_owner_attention: needsOwnerAttention,
      owner_attention_reason: ownerAttentionReason || null,
    });
  } catch (error) {
    if (error instanceof MailboxRepositoryError) {
      throw new MailboxServiceError(error.type, error.message, error.status);
    }
    throw error;
  }
}

export async function resolveMailboxPocket(db, input = {}) {
  const action = String(input.action || '');
  if (!['remember', 'discard'].includes(action)) invalid('action 不是允许的选项。');
  const confidence = input.confidence == null ? 1 : Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    invalid('confidence 超出范围。');
  }
  const visibility = input.visibility == null ? 'visitor_visible' : String(input.visibility);
  if (!['model_partner_only', 'visitor_visible'].includes(visibility)) {
    invalid('visibility 不是允许的选项。');
  }
  try {
    return await resolveMailboxMemoryPocket(db, {
      visitor_id: text(input.visitor_id, 'visitor_id', 240, { required: true }),
      pocket_id: text(input.pocket_id, 'pocket_id', 240, { required: true }),
      action,
      title: text(input.title, 'title', 160),
      life_core: text(input.life_core, 'life_core', 2000),
      content: text(input.content, 'content', 8000),
      usage_hint: input.usage_hint == null ? undefined : text(input.usage_hint, 'usage_hint', 2000),
      avoid_hint: input.avoid_hint == null ? undefined : text(input.avoid_hint, 'avoid_hint', 2000),
      confidence,
      visibility,
      source_conversation_id: text(input.source_conversation_id, 'source_conversation_id', 200),
      source_turn_id: text(input.source_turn_id, 'source_turn_id', 200),
      tool_call_id: text(input.tool_call_id, 'tool_call_id', 240),
    });
  } catch (error) {
    if (error instanceof MailboxRepositoryError) {
      throw new MailboxServiceError(error.type, error.message, error.status);
    }
    throw error;
  }
}

export async function mailboxPatrolReport(db, input = {}) {
  try {
    const report = await completeMailboxPatrol(
      db,
      text(input.batch_id, 'batch_id', 200, { required: true }),
    );
    return {
      ...report,
      summary: `本次巡灯处理 ${report.visitor_count} 位访客，回信 ${report.reply_count} 封。${report.failure_count} 封未完成，${report.needs_owner_attention_count} 封需要屋主处理。`,
    };
  } catch (error) {
    if (error instanceof MailboxRepositoryError) {
      throw new MailboxServiceError(error.type, error.message, error.status);
    }
    throw error;
  }
}

export async function ownerMailboxVisitors(db) {
  return listOwnerMailboxVisitors(db);
}

export async function mailboxOwnerSummary(db) {
  return ownerMailboxSummary(db);
}
