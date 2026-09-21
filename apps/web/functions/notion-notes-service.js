import {
  DevHandsError,
  requireEnabled,
  requireOperationConfirmation,
  requireServerSecret,
} from './dev-hands-policy.js';
import { redactSecretText } from './dev-hands-store.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MAX_PAGE_DEPTH = 32;
const MAX_CONTENT_CHARS = 80_000;
const READ_ACTIONS = new Set(['read_root_page', 'read_page']);
const WRITE_ACTIONS = new Set([
  'append_worklog', 'create_child_page', 'update_page_title', 'append_page_content',
  'create_todo_entry', 'create_risk_entry', 'create_receipt_entry', 'create_acceptance_entry',
]);

function cleanId(value, label = 'page_id') {
  const raw = String(value || '').trim().replace(/-/gu, '');
  if (!/^[a-f0-9]{32}$/iu.test(raw)) throw new DevHandsError('invalid_notion_id', `${label} 无效。`, 400);
  return raw.toLowerCase();
}
function notionRootId(env) {
  return cleanId(requireServerSecret(env, 'COAST_NOTION_ROOT_PAGE_ID', 'Notion root page id'), 'root_page_id');
}
function notionHeaders(env) {
  const token = requireServerSecret(env, 'COAST_NOTION_TOKEN', 'Notion connection token');
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}
async function notionResponse(env, path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: notionHeaders(env),
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  const message = redactSecretText(payload?.message || `Notion 请求失败（${response.status}）`, 700);
  throw new DevHandsError('notion_request_failed', message, response.status, {
    provider: 'notion', provider_status: response.status, provider_code: payload?.code || null,
  });
}
async function notionJson(env, path, options = {}) {
  const response = await notionResponse(env, path, options);
  if (response.status === 204) return { ok: true };
  return response.json();
}

function titleText(page) {
  const props = page?.properties && typeof page.properties === 'object' ? page.properties : {};
  for (const prop of Object.values(props)) {
    if (prop?.type !== 'title' || !Array.isArray(prop.title)) continue;
    return prop.title.map((item) => item?.plain_text || item?.text?.content || '').join('').trim();
  }
  return '';
}
function richText(value) {
  const text = String(value ?? '');
  const out = [];
  for (let offset = 0; offset < text.length; offset += 1900) {
    out.push({ type: 'text', text: { content: text.slice(offset, offset + 1900) } });
  }
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}
function block(type, text, checked = false) {
  if (type === 'to_do') return { object: 'block', type, to_do: { rich_text: richText(text), checked } };
  return { object: 'block', type, [type]: { rich_text: richText(text) } };
}
function textBlocks(value) {
  const source = String(value ?? '').slice(0, MAX_CONTENT_CHARS);
  const lines = source.split(/\r?\n/u);
  const blocks = [];
  for (const line of lines) {
    if (line.startsWith('### ')) blocks.push(block('heading_3', line.slice(4)));
    else if (line.startsWith('## ')) blocks.push(block('heading_2', line.slice(3)));
    else if (line.startsWith('# ')) blocks.push(block('heading_1', line.slice(2)));
    else if (/^- \[[ xX]\] /u.test(line)) blocks.push(block('to_do', line.slice(6), /- \[[xX]\]/u.test(line)));
    else blocks.push(block('paragraph', line));
  }
  return blocks.slice(0, 100);
}
function plainBlockText(value) {
  if (!value || typeof value !== 'object') return '';
  const data = value[value.type];
  const rich = data?.rich_text;
  if (Array.isArray(rich)) return rich.map((item) => item?.plain_text || item?.text?.content || '').join('');
  if (value.type === 'child_page') return value.child_page?.title || '';
  if (value.type === 'child_database') return value.child_database?.title || '';
  return '';
}

async function getPage(env, pageId) {
  return notionJson(env, `/pages/${cleanId(pageId)}`);
}

export async function assertNotionPageInRoot(env, pageId, { allowRoot = true } = {}) {
  const root = notionRootId(env);
  let current = cleanId(pageId);
  if (current === root) {
    if (allowRoot) return { root, page_id: current, depth: 0 };
    throw new DevHandsError('notion_root_protected', 'Notion 根页面不能执行这个动作。', 403);
  }
  for (let depth = 1; depth <= MAX_PAGE_DEPTH; depth += 1) {
    const page = await getPage(env, current);
    const parent = page?.parent || {};
    if (parent.type !== 'page_id' || !parent.page_id) {
      throw new DevHandsError('notion_outside_root', '目标页面不在 Elementera Coast 工作日志根页面下。', 403);
    }
    const parentId = cleanId(parent.page_id);
    if (parentId === root) return { root, page_id: cleanId(pageId), depth };
    current = parentId;
  }
  throw new DevHandsError('notion_parent_depth_exceeded', 'Notion 页面层级超过海岸安全检查范围。', 400);
}

export async function notionSelfCheck(env, { readEnabled = true } = {}) {
  const tokenPresent = typeof env?.COAST_NOTION_TOKEN === 'string' && env.COAST_NOTION_TOKEN.trim().length > 0;
  const rootPresent = typeof env?.COAST_NOTION_ROOT_PAGE_ID === 'string' && env.COAST_NOTION_ROOT_PAGE_ID.trim().length > 0;
  const result = {
    notion_token_present: tokenPresent,
    root_page_id_present: rootPresent,
    notion_read_enabled: Boolean(readEnabled),
    root_page_readable: null,
    root_page_title: null,
    can_append_test_block: null,
    write_test_requires_confirmation: true,
  };
  if (!tokenPresent || !rootPresent || !readEnabled) return result;
  try {
    const page = await getPage(env, notionRootId(env));
    result.root_page_readable = true;
    result.root_page_title = titleText(page) || null;
  } catch (error) {
    result.root_page_readable = false;
    result.error_type = error?.type || 'notion_request_failed';
  }
  return result;
}

export function notionActionPolicy(actionValue, params = {}) {
  const action = String(actionValue || '').trim();
  if (READ_ACTIONS.has(action)) return { action, operationType: 'read', label: action };
  if (action === 'delete_page') return { action, operationType: 'dangerous', label: '删除 Notion 页面' };
  if (action === 'update_page_content' && String(params.mode || 'append') === 'replace') {
    return { action, operationType: 'dangerous', label: '大段覆盖 Notion 页面' };
  }
  if (action === 'update_page_content') return { action, operationType: 'write', label: 'update_page_content' };
  if (WRITE_ACTIONS.has(action)) return { action, operationType: 'write', label: action };
  throw new DevHandsError('unknown_notion_action', '未知 Notion 小纸条动作。', 400);
}

export function enforceNotionPolicy(settings, policy, input = {}) {
  if (policy.operationType === 'read') requireEnabled(settings, 'notion_read', 'Notion 读工具');
  else requireEnabled(settings, 'notion_write', 'Notion 写工具');
  if (policy.action === 'delete_page') requireEnabled(settings, 'notion_delete', 'Notion 删除工具');
  return requireOperationConfirmation(policy.operationType, policy.label, input);
}

async function pageSummary(env, pageId, { includeContent = false, startCursor = '' } = {}) {
  await assertNotionPageInRoot(env, pageId, { allowRoot: true });
  const page = await getPage(env, pageId);
  const summary = {
    page_id: cleanId(page.id || pageId),
    title: titleText(page),
    url: page.url || null,
    in_trash: Boolean(page.in_trash),
    created_time: page.created_time || null,
    last_edited_time: page.last_edited_time || null,
  };
  if (!includeContent) return summary;
  const cursor = String(startCursor || '').trim();
  const data = await notionJson(env, `/blocks/${cleanId(pageId)}/children?${new URLSearchParams({
    page_size: '100', ...(cursor ? { start_cursor: cursor } : {}),
  })}`);
  return {
    ...summary,
    blocks: (data.results || []).map((item) => ({ id: item.id, type: item.type, text: plainBlockText(item), has_children: Boolean(item.has_children), in_trash: Boolean(item.in_trash) })),
    has_more: Boolean(data.has_more),
    next_cursor: data.next_cursor || null,
  };
}

async function appendBlocks(env, pageId, content) {
  await assertNotionPageInRoot(env, pageId, { allowRoot: true });
  const children = textBlocks(content);
  if (!children.length) throw new DevHandsError('notion_content_required', '先写一点小纸条内容。', 400);
  const result = await notionJson(env, `/blocks/${cleanId(pageId)}/children`, { method: 'PATCH', body: { children, position: { type: 'end' } } });
  return { page_id: cleanId(pageId), appended_blocks: Array.isArray(result.results) ? result.results.length : children.length };
}

async function createChild(env, { parentPageId, title, content = '' }) {
  await assertNotionPageInRoot(env, parentPageId, { allowRoot: true });
  const cleanTitle = String(title || '').trim().slice(0, 300);
  if (!cleanTitle) throw new DevHandsError('notion_title_required', '子页面需要标题。', 400);
  const payload = {
    parent: { type: 'page_id', page_id: cleanId(parentPageId) },
    properties: { title: { type: 'title', title: richText(cleanTitle) } },
  };
  const children = textBlocks(content);
  if (children.length) payload.children = children;
  const page = await notionJson(env, '/pages', { method: 'POST', body: payload });
  return { page_id: cleanId(page.id), title: titleText(page) || cleanTitle, url: page.url || null };
}

async function replacePageContent(env, pageId, content) {
  await assertNotionPageInRoot(env, pageId, { allowRoot: true });
  const childIds = [];
  let cursor = '';
  do {
    const data = await notionJson(env, `/blocks/${cleanId(pageId)}/children?${new URLSearchParams({ page_size: '100', ...(cursor ? { start_cursor: cursor } : {}) })}`);
    for (const child of data.results || []) childIds.push(cleanId(child.id, 'block_id'));
    cursor = data.has_more ? data.next_cursor || '' : '';
  } while (cursor);
  for (const childId of childIds) {
    await notionJson(env, `/blocks/${childId}`, { method: 'DELETE' });
  }
  const appended = await appendBlocks(env, pageId, content);
  return { page_id: cleanId(pageId), removed_blocks: childIds.length, appended_blocks: appended.appended_blocks };
}

function categorizedTitle(kind, title) {
  const labels = { todo: '待办', risk: '风险', receipt: '回执', acceptance: '竣工清单' };
  const label = labels[kind] || '施工单';
  return `【${label}】${String(title || '').trim() || new Date().toISOString().slice(0, 10)}`.slice(0, 300);
}

export async function executeNotionAction(env, actionValue, paramsValue = {}) {
  const params = paramsValue && typeof paramsValue === 'object' && !Array.isArray(paramsValue) ? paramsValue : {};
  const action = String(actionValue || '').trim();
  const root = notionRootId(env);
  if (action === 'read_root_page') return pageSummary(env, root, { includeContent: Boolean(params.include_content), startCursor: params.start_cursor });
  if (action === 'read_page') return pageSummary(env, cleanId(params.page_id), { includeContent: params.include_content !== false, startCursor: params.start_cursor });
  if (action === 'append_worklog') {
    const content = String(params.content || '').slice(0, MAX_CONTENT_CHARS);
    const stamp = String(params.title || '').trim();
    const combined = stamp ? `## ${stamp}\n${content}` : content;
    const result = await appendBlocks(env, root, combined);
    return { ...result, kind: 'worklog' };
  }
  if (action === 'create_child_page') {
    return createChild(env, { parentPageId: params.parent_page_id ? cleanId(params.parent_page_id) : root, title: params.title, content: params.content });
  }
  if (action === 'update_page_title') {
    const pageId = cleanId(params.page_id);
    await assertNotionPageInRoot(env, pageId, { allowRoot: true });
    const title = String(params.title || '').trim().slice(0, 300);
    if (!title) throw new DevHandsError('notion_title_required', '页面标题不能为空。', 400);
    const page = await notionJson(env, `/pages/${pageId}`, { method: 'PATCH', body: { properties: { title: { type: 'title', title: richText(title) } } } });
    return { page_id: pageId, title: titleText(page) || title, url: page.url || null };
  }
  if (action === 'append_page_content') return appendBlocks(env, cleanId(params.page_id), params.content);
  if (action === 'update_page_content') {
    const pageId = cleanId(params.page_id);
    return String(params.mode || 'append') === 'replace'
      ? replacePageContent(env, pageId, params.content)
      : appendBlocks(env, pageId, params.content);
  }
  if (action === 'create_todo_entry') return createChild(env, { parentPageId: root, title: categorizedTitle('todo', params.title), content: params.content });
  if (action === 'create_risk_entry') return createChild(env, { parentPageId: root, title: categorizedTitle('risk', params.title), content: params.content });
  if (action === 'create_receipt_entry') return createChild(env, { parentPageId: root, title: categorizedTitle('receipt', params.title), content: params.content });
  if (action === 'create_acceptance_entry') return createChild(env, { parentPageId: root, title: categorizedTitle('acceptance', params.title), content: params.content });
  if (action === 'delete_page') {
    const pageId = cleanId(params.page_id);
    await assertNotionPageInRoot(env, pageId, { allowRoot: false });
    const page = await notionJson(env, `/pages/${pageId}`, { method: 'PATCH', body: { in_trash: true } });
    return { page_id: pageId, title: titleText(page), in_trash: Boolean(page.in_trash) };
  }
  throw new DevHandsError('unknown_notion_action', '未知 Notion 小纸条动作。', 400);
}
