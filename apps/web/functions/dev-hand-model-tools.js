import { DevHandsError, allowedRepos } from './dev-hands-policy.js';
import { finishDevRun, startDevRun } from './dev-hands-store.js';
import { executeGitHubAction, githubActionPolicy, githubSelfCheck } from './github-dev-service.js';
import { executeNotionAction, notionActionPolicy, notionSelfCheck } from './notion-notes-service.js';

export const DEV_HAND_PACKS = Object.freeze({
  status: '状态与自检',
  githubRead: 'GitHub 仓库眼睛',
  githubWrite: 'GitHub 改动手',
  ci: 'CI 工坊',
  notion: 'Notion 小纸条',
});

function objectSchema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}
function modelTool(name, description, properties = {}, required = []) {
  return Object.freeze({ type: 'function', function: { name, description, parameters: objectSchema(properties, required) } });
}
function spec(value) { return Object.freeze(value); }
const REPO = { repo: { type: 'string', description: '项目 GitHub allowlist 中的 owner/repo。' } };
const PAGE = { page: { type: 'integer', minimum: 1, maximum: 1000 }, per_page: { type: 'integer', minimum: 1, maximum: 100 } };
function github(name, action, risk, description, properties = {}, required = ['repo'], pack = null) {
  return spec({ name, action, risk, system: 'GitHub', pack: pack || (risk === 'read' ? DEV_HAND_PACKS.githubRead : DEV_HAND_PACKS.githubWrite), model_tool: modelTool(name, description, { ...REPO, ...properties }, required) });
}
function notion(name, action, risk, description, properties = {}, required = []) {
  return spec({ name, action, risk, system: 'Notion', pack: DEV_HAND_PACKS.notion, model_tool: modelTool(name, description, properties, required) });
}

const DEFINITIONS = Object.freeze([
  spec({ name: 'devhand_self_check', action: 'devhand_self_check', risk: 'read', system: '开发手', pack: DEV_HAND_PACKS.status, model_tool: modelTool('devhand_self_check', '检查 GitHub、Notion 与开发手基础连接状态，不返回任何 secret。') }),
  spec({ name: 'github_self_check', action: 'github_self_check', risk: 'read', system: 'GitHub', pack: DEV_HAND_PACKS.status, model_tool: modelTool('github_self_check', '检查 GitHub token 是否存在、allowlist 仓库与 Actions 是否可读；不返回 token。') }),
  spec({ name: 'notion_self_check', action: 'notion_self_check', risk: 'read', system: 'Notion', pack: DEV_HAND_PACKS.status, model_tool: modelTool('notion_self_check', '检查 Notion root 是否可读；不返回 token。') }),
  spec({ name: 'model_tool_support_check', action: 'model_tool_support_check', risk: 'read', system: '模型', pack: DEV_HAND_PACKS.status, model_tool: modelTool('model_tool_support_check', '确认当前模型已经成功进入 tool-call 循环。') }),

  spec({ name: 'github_list_allowed_repos', action: 'list_allowed_repos', risk: 'read', system: 'GitHub', pack: DEV_HAND_PACKS.githubRead, model_tool: modelTool('github_list_allowed_repos', '列出项目允许访问的 GitHub 仓库。') }),
  github('github_get_repo', 'get_repo', 'read', '读取仓库 metadata。'),
  github('github_list_branches', 'list_branches', 'read', '列出仓库 branches。', PAGE),
  github('github_get_default_branch', 'get_default_branch', 'read', '读取仓库默认分支。'),
  github('github_read_file', 'read_file', 'read', '读取仓库文本文件。若服务返回 truncated=true，必须明确说明没有完整读完。', { path: { type: 'string', minLength: 1, maxLength: 1200 }, ref: { type: 'string', maxLength: 240 } }, ['repo', 'path']),
  github('github_list_directory', 'list_directory', 'read', '读取仓库目录。', { path: { type: 'string', maxLength: 1200 }, ref: { type: 'string', maxLength: 240 } }),
  github('github_search_code', 'search_code', 'read', '在 allowlist 仓库搜索代码。', { query: { type: 'string', minLength: 1, maxLength: 500 }, ...PAGE }, ['repo', 'query']),
  github('github_search_commits', 'search_commits', 'read', '搜索或列出仓库 commits。query 可留空读取近期 commits。', { query: { type: 'string', maxLength: 500 }, branch: { type: 'string', maxLength: 240 }, path: { type: 'string', maxLength: 1200 }, ...PAGE }),
  github('github_get_commit', 'get_commit', 'read', '读取一个 commit 及文件变更摘要。', { sha: { type: 'string', minLength: 1, maxLength: 120 } }, ['repo', 'sha']),
  github('github_compare_commits', 'compare_commits', 'read', '比较两个 commit/ref。', { base: { type: 'string', minLength: 1, maxLength: 240 }, head: { type: 'string', minLength: 1, maxLength: 240 } }, ['repo', 'base', 'head']),
  github('github_list_prs', 'list_prs', 'read', '列出 PR。', { state: { type: 'string', enum: ['open', 'closed', 'all'] }, ...PAGE }),
  github('github_get_pr', 'get_pr', 'read', '读取一个 PR。', { pr_number: { type: 'integer', minimum: 1 } }, ['repo', 'pr_number']),
  github('github_get_pr_diff', 'get_pr_diff', 'read', '读取 PR unified diff。', { pr_number: { type: 'integer', minimum: 1 } }, ['repo', 'pr_number']),
  github('github_get_pr_files', 'get_pr_files', 'read', '读取 PR 文件列表。', { pr_number: { type: 'integer', minimum: 1 }, ...PAGE }, ['repo', 'pr_number']),
  github('github_list_issues', 'get_issues', 'read', '列出 issues。', { state: { type: 'string', enum: ['open', 'closed', 'all'] }, ...PAGE }),
  github('github_get_issue', 'get_issue', 'read', '读取 issue。', { issue_number: { type: 'integer', minimum: 1 } }, ['repo', 'issue_number']),
  github('github_list_deployments', 'list_deployments', 'read', '列出 deployments。', { environment: { type: 'string', maxLength: 120 }, ...PAGE }),
  github('github_get_pages', 'get_pages', 'read', '读取 GitHub Pages 配置。'),
  github('github_list_workflows', 'list_workflows', 'read', '列出 Actions workflows。', PAGE, ['repo'], DEV_HAND_PACKS.ci),

  github('github_create_branch', 'create_branch', 'write', '创建 branch。直接执行。', { branch: { type: 'string', minLength: 1, maxLength: 240 }, from: { type: 'string', maxLength: 240 } }, ['repo', 'branch']),
  github('github_create_or_update_file', 'create_or_update_file', 'write', '创建或更新文件，可按参数写入 branch 或 main。直接执行。', { path: { type: 'string', minLength: 1, maxLength: 1200 }, branch: { type: 'string', maxLength: 240 }, content: { type: 'string' }, message: { type: 'string', maxLength: 240 }, sha: { type: 'string', maxLength: 120 }, bulk: { type: 'boolean' } }, ['repo', 'path', 'content']),
  github('github_delete_file', 'delete_file', 'dangerous', '删除文件。直接执行。', { path: { type: 'string', minLength: 1, maxLength: 1200 }, branch: { type: 'string', maxLength: 240 }, sha: { type: 'string', maxLength: 120 }, message: { type: 'string', maxLength: 240 } }, ['repo', 'path']),
  github('github_update_workflow_file', 'update_workflow_file', 'dangerous', '创建或更新 .github/workflows 下的 workflow 文件。直接执行。', { path: { type: 'string', pattern: '^\\.github/workflows/', maxLength: 1200 }, branch: { type: 'string', minLength: 1, maxLength: 240 }, content: { type: 'string' }, message: { type: 'string', maxLength: 240 }, sha: { type: 'string', maxLength: 120 } }, ['repo', 'path', 'branch', 'content']),
  github('github_update_deployment_status', 'create_deployment_status', 'dangerous', '更新 deployment status。直接执行。', { deployment_id: { type: 'integer', minimum: 1 }, state: { type: 'string', enum: ['error', 'failure', 'inactive', 'in_progress', 'queued', 'pending', 'success'] }, description: { type: 'string', maxLength: 240 }, environment: { type: 'string', maxLength: 120 }, log_url: { type: 'string', maxLength: 2000 } }, ['repo', 'deployment_id', 'state']),
  github('github_update_pages', 'update_pages', 'dangerous', '修改 GitHub Pages 配置。直接执行。', { config: { type: 'object', additionalProperties: true } }, ['repo', 'config']),
  github('github_create_pr', 'create_pr', 'write', '创建 PR。直接执行。', { title: { type: 'string', minLength: 1, maxLength: 300 }, head: { type: 'string', minLength: 1, maxLength: 240 }, base: { type: 'string', maxLength: 240 }, body: { type: 'string' }, draft: { type: 'boolean' } }, ['repo', 'title', 'head']),
  github('github_update_pr', 'update_pr', 'write', '更新或关闭 PR。直接执行。', { pr_number: { type: 'integer', minimum: 1 }, title: { type: 'string', maxLength: 300 }, body: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed'] }, base: { type: 'string', maxLength: 240 } }, ['repo', 'pr_number']),
  github('github_comment_pr', 'comment_pr', 'write', '评论 PR。直接执行。', { pr_number: { type: 'integer', minimum: 1 }, body: { type: 'string', minLength: 1 } }, ['repo', 'pr_number', 'body']),
  github('github_merge_pr', 'merge_pr', 'dangerous', 'merge PR。直接执行。', { pr_number: { type: 'integer', minimum: 1 }, merge_method: { type: 'string', enum: ['merge', 'squash', 'rebase'] } }, ['repo', 'pr_number']),
  github('github_create_issue', 'create_issue', 'write', '创建 issue。直接执行。', { title: { type: 'string', minLength: 1, maxLength: 300 }, body: { type: 'string' } }, ['repo', 'title']),
  github('github_update_issue', 'update_issue', 'write', '更新或关闭 issue。直接执行。', { issue_number: { type: 'integer', minimum: 1 }, title: { type: 'string', maxLength: 300 }, body: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed'] } }, ['repo', 'issue_number']),
  github('github_add_issue_comment', 'add_issue_comment', 'write', '评论 issue。直接执行。', { issue_number: { type: 'integer', minimum: 1 }, body: { type: 'string', minLength: 1 } }, ['repo', 'issue_number', 'body']),

  github('ci_list_recent_runs', 'list_workflow_runs', 'read', '读取近期 workflow runs。', { branch: { type: 'string', maxLength: 240 }, status: { type: 'string', maxLength: 80 }, event: { type: 'string', maxLength: 80 }, ...PAGE }, ['repo'], DEV_HAND_PACKS.ci),
  github('ci_get_run_summary', 'get_workflow_run', 'read', '读取 workflow run 摘要。', { workflow_run_id: { type: 'integer', minimum: 1 } }, ['repo', 'workflow_run_id'], DEV_HAND_PACKS.ci),
  github('ci_get_run_jobs', 'get_workflow_jobs', 'read', '读取 workflow run jobs。', { workflow_run_id: { type: 'integer', minimum: 1 }, ...PAGE }, ['repo', 'workflow_run_id'], DEV_HAND_PACKS.ci),
  github('ci_get_job_steps', 'get_job_steps', 'read', '读取 job steps。', { job_id: { type: 'integer', minimum: 1 } }, ['repo', 'job_id'], DEV_HAND_PACKS.ci),
  github('ci_get_redacted_logs', 'get_job_logs', 'read', '读取已脱敏 job logs。', { job_id: { type: 'integer', minimum: 1 } }, ['repo', 'job_id'], DEV_HAND_PACKS.ci),
  github('ci_get_failed_steps', 'get_failed_steps', 'read', '读取 workflow run 的失败 steps。', { workflow_run_id: { type: 'integer', minimum: 1 } }, ['repo', 'workflow_run_id'], DEV_HAND_PACKS.ci),
  github('ci_rerun_failed_jobs', 'rerun_failed_jobs', 'dangerous', '重跑失败 jobs。直接执行。', { workflow_run_id: { type: 'integer', minimum: 1 } }, ['repo', 'workflow_run_id'], DEV_HAND_PACKS.ci),
  github('ci_rerun_job', 'rerun_job', 'dangerous', '重跑 job。直接执行。', { job_id: { type: 'integer', minimum: 1 } }, ['repo', 'job_id'], DEV_HAND_PACKS.ci),

  notion('notion_read_root_page', 'read_root_page', 'read', '读取 Elementera Coast 工作日志 root。', { include_content: { type: 'boolean' }, start_cursor: { type: 'string', maxLength: 200 } }),
  notion('notion_list_child_pages', 'list_child_pages', 'read', '列出工作日志 root 直接子页面。'),
  notion('notion_read_page', 'read_page', 'read', '读取 root 下授权子页面。', { page_id: { type: 'string', minLength: 1, maxLength: 80 }, include_content: { type: 'boolean' }, start_cursor: { type: 'string', maxLength: 200 } }, ['page_id']),
  notion('notion_append_worklog', 'append_worklog', 'write', '追加工作日志。直接执行。', { title: { type: 'string', maxLength: 300 }, content: { type: 'string', minLength: 1 } }, ['content']),
  notion('notion_create_child_page', 'create_child_page', 'write', '创建子页面。直接执行。', { parent_page_id: { type: 'string', maxLength: 80 }, title: { type: 'string', minLength: 1, maxLength: 300 }, content: { type: 'string' } }, ['title']),
  notion('notion_update_page_title', 'update_page_title', 'write', '更新授权页面标题。直接执行。', { page_id: { type: 'string', minLength: 1, maxLength: 80 }, title: { type: 'string', minLength: 1, maxLength: 300 } }, ['page_id', 'title']),
  notion('notion_append_receipt', 'create_receipt_entry', 'write', '写回执小纸条。直接执行。', { title: { type: 'string', maxLength: 300 }, content: { type: 'string' } }),
  notion('notion_append_todo', 'create_todo_entry', 'write', '写待办小纸条。直接执行。', { title: { type: 'string', maxLength: 300 }, content: { type: 'string' } }),
  notion('notion_append_risk', 'create_risk_entry', 'write', '写风险小纸条。直接执行。', { title: { type: 'string', maxLength: 300 }, content: { type: 'string' } }),
  notion('notion_append_acceptance', 'create_acceptance_entry', 'write', '写竣工清单。直接执行。', { title: { type: 'string', maxLength: 300 }, content: { type: 'string' } }),
  notion('notion_update_page_content', 'update_page_content', 'write', '追加或覆盖授权页面内容。直接执行。', { page_id: { type: 'string', minLength: 1, maxLength: 80 }, content: { type: 'string' }, mode: { type: 'string', enum: ['append', 'replace'] } }, ['page_id', 'content']),
  notion('notion_delete_page', 'delete_page', 'dangerous', '删除授权子页面。直接执行。', { page_id: { type: 'string', minLength: 1, maxLength: 80 } }, ['page_id']),
]);

const BY_NAME = new Map(DEFINITIONS.map((item) => [item.name, item]));

function parseArguments(toolCall) {
  const raw = toolCall?.function?.arguments ?? toolCall?.arguments ?? {};
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not_object');
    return value;
  } catch {
    throw new DevHandsError('invalid_tool_arguments', '开发手参数不是有效 JSON 对象。', 400);
  }
}
function normalizeRepoParams(env, definition, params = {}) {
  const raw = String(params.repo || '').trim().replace(/^\/+|\/+$/gu, '');
  if (!raw) return params;
  const allowed = allowedRepos(env);
  if (allowed.includes(raw)) return params;

  const matches = allowed.map((repo) => {
    const [, name = ''] = repo.split('/');
    if (raw === name) return { repo, suffix: '' };
    if (raw.startsWith(`${name}/`)) return { repo, suffix: raw.slice(name.length + 1) };
    if (raw.startsWith(`${repo}/`)) return { repo, suffix: raw.slice(repo.length + 1) };
    return null;
  }).filter(Boolean);

  if (matches.length !== 1) return params;
  const match = matches[0];
  const normalized = { ...params, repo: match.repo };
  if (match.suffix) {
    if (!normalized.ref && ['read_file', 'list_directory'].includes(definition.action)) normalized.ref = match.suffix;
    if (!normalized.branch && ['search_commits', 'list_workflow_runs'].includes(definition.action)) normalized.branch = match.suffix;
  }
  return normalized;
}

function targetRef(definition, params = {}) {
  if (params.repo) return String(params.repo).slice(0, 260);
  if (params.page_id) return String(params.page_id).slice(0, 260);
  if (params.parent_page_id) return String(params.parent_page_id).slice(0, 260);
  return definition.system;
}
function actualRisk(definition, params) {
  if (definition.system === 'GitHub') {
    if (['github_self_check', 'list_allowed_repos', 'get_default_branch', 'get_failed_steps'].includes(definition.action)) {
      return definition.risk;
    }
    return githubActionPolicy(definition.action, params).operationType;
  }
  if (definition.system === 'Notion') {
    if (definition.action === 'list_child_pages') return 'read';
    return notionActionPolicy(definition.action, params).operationType;
  }
  return definition.risk;
}

async function executeVirtual(definition, env, db, params, context) {
  if (definition.name === 'devhand_self_check') {
    const [github, notion] = await Promise.all([githubSelfCheck(env, { readEnabled: true }), notionSelfCheck(env, { readEnabled: true })]);
    return { github, notion, tools_exposed: DEFINITIONS.length, model_tool_support: context.model_tool_support || { supported: true, reason: 'tool_call_received' } };
  }
  if (definition.name === 'github_self_check') return githubSelfCheck(env, { readEnabled: true });
  if (definition.name === 'notion_self_check') return notionSelfCheck(env, { readEnabled: true });
  if (definition.name === 'model_tool_support_check') return { supported: true, reason: 'tool_call_received' };
  if (definition.action === 'list_allowed_repos') return { allowed_repos: allowedRepos(env) };
  if (definition.action === 'get_default_branch') {
    const repo = await executeGitHubAction(env, 'get_repo', params);
    return { repo: repo.repo, default_branch: repo.default_branch };
  }
  if (definition.action === 'get_failed_steps') {
    const jobs = await executeGitHubAction(env, 'get_workflow_jobs', params);
    const failed = [];
    for (const job of jobs.jobs || []) {
      const detail = await executeGitHubAction(env, 'get_job_steps', { repo: params.repo, job_id: job.job_id });
      const steps = (detail.steps || []).filter((step) => step.conclusion === 'failure');
      if (steps.length) failed.push({ job_id: job.job_id, job_name: job.name, steps });
    }
    return { repo: params.repo, workflow_run_id: params.workflow_run_id, failed_jobs: failed, count: failed.reduce((sum, item) => sum + item.steps.length, 0) };
  }
  if (definition.action === 'list_child_pages') {
    const root = await executeNotionAction(env, 'read_root_page', { include_content: true });
    return { page_id: root.page_id, title: root.title, children: (root.blocks || []).filter((item) => item.type === 'child_page').map((item) => ({ page_id: item.id, title: item.text, has_children: item.has_children })) };
  }
  if (definition.system === 'GitHub') return executeGitHubAction(env, definition.action, params);
  if (definition.system === 'Notion') return executeNotionAction(env, definition.action, params);
  throw new DevHandsError('dev_hand_unimplemented', '这件开发手尚未接入执行器。', 500, { tool: definition.name });
}

const DEV_HAND_CHAT_SURFACES = new Set(['main_chat', 'radio', 'lighthouse']);

export const DEV_HAND_MODEL_TOOLS = Object.freeze(DEFINITIONS.map((item) => item.model_tool));
export const DEV_HAND_TOOL_RECORDS = Object.freeze(DEFINITIONS.map((item) => Object.freeze({
  model_name: item.name,
  display_name: item.name,
  tool_key: `devhand.${item.name}`,
  model_group: 'devhand',
  tool_pack: item.pack,
  risk: item.risk,
  target_system: item.system,
  model_exposed: true,
  owner_only: true,
  visitor_allowed: false,
})));

export function isDevHandModelTool(name) { return BY_NAME.has(String(name || '')); }

export function resolveDevHandToolSelection({ permission = 'owner', surface = '' } = {}) {
  const ownerChat = permission === 'owner' && DEV_HAND_CHAT_SURFACES.has(surface);
  return ownerChat
    ? { tools: DEV_HAND_MODEL_TOOLS, records: DEV_HAND_TOOL_RECORDS }
    : { tools: [], records: [] };
}

export async function executeDevHandModelTool(env, db, toolCall, context = {}) {
  const name = String(toolCall?.function?.name || toolCall?.name || '').trim();
  const definition = BY_NAME.get(name);
  if (!definition) throw new DevHandsError('unknown_dev_hand_tool', '模型调用了未注册开发手。', 400, { tool: name });
  if (context.permission !== 'owner' || !DEV_HAND_CHAT_SURFACES.has(context.surface)) {
    throw new DevHandsError('dev_hand_forbidden', '这个界面不能使用屋主开发手。', 403, { tool: name });
  }
  const parsedParams = parseArguments(toolCall);
  const params = normalizeRepoParams(env, definition, parsedParams);
  const risk = actualRisk(definition, params);
  const runId = await startDevRun(db, {
    targetSystem: definition.system,
    actionName: name,
    targetRef: targetRef(definition, params),
    operationType: risk,
    input: params,
  });
  try {
    const result = await executeVirtual(definition, env, db, params, context);
    await finishDevRun(db, runId, { status: 'success', output: result });
    return { ok: true, tool: name, tool_pack: definition.pack, result };
  } catch (error) {
    await finishDevRun(db, runId, { status: 'error', error });
    throw error;
  }
}

export const DEV_HAND_TOOL_COUNT = DEFINITIONS.length;
