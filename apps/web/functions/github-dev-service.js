import {
  DevHandsError,
  allowedRepos,
  requireAllowedRepo,
  requireEnabled,
  requireOperationConfirmation,
  requireServerSecret,
} from './dev-hands-policy.js';
import { redactSecretText } from './dev-hands-store.js';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_FILE_CHARS = 1_500_000;
const MAX_LOG_CHARS = 500_000;

const READ_ACTIONS = new Set([
  'get_repo', 'list_branches', 'read_file', 'list_directory', 'search_code', 'search_commits',
  'get_commit', 'compare_commits', 'list_prs', 'get_pr', 'get_pr_diff', 'get_pr_files',
  'get_issues', 'get_issue', 'list_workflow_runs', 'get_workflow_run', 'get_workflow_jobs',
  'get_job_steps', 'get_job_logs', 'list_artifacts', 'get_artifact_metadata',
  'list_releases', 'get_release', 'get_release_asset', 'list_deployments',
  'get_pages', 'list_workflows',
]);
const CI_ACTIONS = new Set([
  'list_workflow_runs', 'get_workflow_run', 'get_workflow_jobs', 'get_job_steps', 'get_job_logs',
  'list_artifacts', 'get_artifact_metadata', 'list_workflows', 'rerun_failed_jobs', 'rerun_job',
]);
const ARTIFACT_ACTIONS = new Set(['list_artifacts', 'get_artifact_metadata']);
const WRITE_ACTIONS = new Set([
  'create_branch', 'create_or_update_file', 'update_workflow_file', 'create_pr', 'update_pr', 'comment_pr',
  'create_issue', 'update_issue', 'add_issue_comment',
]);
const ALWAYS_DANGEROUS = Object.freeze({
  delete_file: '删除文件',
  merge_pr: 'merge PR',
  rerun_failed_jobs: '重跑 workflow',
  rerun_job: '重跑 workflow',
  create_deployment_status: '更新 deployment 状态',
  update_pages: '修改 Pages 配置',
});

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
function encoded(value) { return encodeURIComponent(String(value ?? '')); }
function qs(params = {}) {
  const value = new URLSearchParams();
  for (const [key, item] of Object.entries(params)) {
    if (item == null || item === '') continue;
    value.set(key, String(item));
  }
  const text = value.toString();
  return text ? `?${text}` : '';
}
function targetRepoPath(repo) { return `/repos/${repo}`; }
function requireNumber(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new DevHandsError('invalid_github_id', `${label} 无效。`, 400);
  return number;
}
function cleanPath(value) {
  const path = String(value || '').replace(/^\/+/, '').trim();
  if (!path || path.includes('\0')) throw new DevHandsError('invalid_path', '文件路径无效。', 400);
  if (path.split('/').some((part) => part === '..')) throw new DevHandsError('invalid_path', '文件路径不能包含 ..。', 400);
  return path;
}
function cleanBranch(value, fallback = 'main') {
  const branch = String(value || fallback).trim();
  if (!branch || branch.length > 240 || /[\s~^:?*[\\]/u.test(branch)) {
    throw new DevHandsError('invalid_branch', 'branch 名称无效。', 400);
  }
  return branch;
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(String(value || '').replace(/\s+/gu, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function decodeGitHubFile(value) {
  if (value?.encoding !== 'base64' || typeof value.content !== 'string') return { content: null, binary: true };
  const bytes = base64ToBytes(value.content);
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  const nulls = sample.reduce((sum, byte) => sum + (byte === 0 ? 1 : 0), 0);
  if (nulls > Math.max(2, sample.length * 0.01)) return { content: null, binary: true, bytes: bytes.length };
  const text = new TextDecoder().decode(bytes);
  return {
    content: text.slice(0, MAX_FILE_CHARS),
    binary: false,
    chars: text.length,
    truncated: text.length > MAX_FILE_CHARS,
  };
}

function githubHeaders(env, { json = true, accept = null } = {}) {
  const token = requireServerSecret(env, 'COAST_GITHUB_TOKEN', 'GitHub 开发手 token');
  return {
    Accept: accept || (json ? 'application/vnd.github+json' : 'application/vnd.github.raw+json'),
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'Elementera-Coast-Dev-Hand',
  };
}

async function githubResponse(env, path, { method = 'GET', body = null, raw = false, accept = null } = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      ...githubHeaders(env, { json: !raw, accept }),
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body == null ? undefined : JSON.stringify(body),
    redirect: 'follow',
  });
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  const message = redactSecretText(payload?.message || `GitHub 请求失败（${response.status}）`, 600);
  throw new DevHandsError('github_request_failed', message, response.status, {
    provider: 'github',
    provider_status: response.status,
  });
}
async function githubJson(env, path, options = {}) {
  const response = await githubResponse(env, path, options);
  if (response.status === 204) return { ok: true };
  return response.json();
}
async function githubText(env, path, options = {}) {
  const response = await githubResponse(env, path, options);
  return response.text();
}
export async function githubArtifactBytes(env, repo, artifactId) {
  const allowed = requireAllowedRepo(env, repo);
  const id = requireNumber(artifactId, 'artifact_id');
  const response = await githubResponse(env, `${targetRepoPath(allowed)}/actions/artifacts/${id}/zip`, { raw: true });
  return new Uint8Array(await response.arrayBuffer());
}

export async function githubReleaseAssetBytes(env, repo, assetId) {
  const allowed = requireAllowedRepo(env, repo);
  const id = requireNumber(assetId, 'release_asset_id');
  const response = await githubResponse(
    env,
    `${targetRepoPath(allowed)}/releases/assets/${id}`,
    { raw: true, accept: 'application/octet-stream' },
  );
  return new Uint8Array(await response.arrayBuffer());
}

export async function githubSelfCheck(env, { readEnabled = true } = {}) {
  const allowed = allowedRepos(env);
  const tokenPresent = typeof env?.COAST_GITHUB_TOKEN === 'string' && env.COAST_GITHUB_TOKEN.trim().length > 0;
  const result = {
    github_token_present: tokenPresent,
    allowed_repos: allowed,
    github_read_enabled: Boolean(readEnabled),
    repo_metadata_readable: null,
    can_read_default_branch: null,
    can_read_actions: null,
    repos: [],
  };
  if (!tokenPresent || !readEnabled) return result;
  const repos = [];
  for (const repo of allowed) {
    try {
      const meta = await githubJson(env, targetRepoPath(repo));
      const branch = String(meta.default_branch || 'main');
      await githubJson(env, `${targetRepoPath(repo)}/branches/${encoded(branch)}`);
      repos.push({ repo, readable: true, default_branch: branch, private: Boolean(meta.private) });
    } catch (error) {
      repos.push({ repo, readable: false, error_type: error?.type || 'github_request_failed' });
    }
  }
  result.repos = repos;
  result.repo_metadata_readable = allowed.length > 0 && repos.every((item) => item.readable);
  result.can_read_default_branch = result.repo_metadata_readable;
  const native = allowed.find((repo) => repo.endsWith('/coast-native-android')) || allowed[0];
  if (native) {
    try {
      await githubJson(env, `${targetRepoPath(native)}/actions/runs?per_page=1`);
      result.can_read_actions = true;
    } catch {
      result.can_read_actions = false;
    }
  }
  return result;
}

export function githubActionPolicy(actionValue, params = {}) {
  const action = String(actionValue || '').trim();
  if (READ_ACTIONS.has(action)) return { action, operationType: 'read', label: action };
  if (Object.hasOwn(ALWAYS_DANGEROUS, action)) {
    return { action, operationType: 'dangerous', label: ALWAYS_DANGEROUS[action] };
  }
  if (!WRITE_ACTIONS.has(action)) throw new DevHandsError('unknown_github_action', '未知 GitHub 开发手动作。', 400);
  if (action === 'update_workflow_file') return { action, operationType: 'dangerous', label: '修改 workflow' };
  if (action === 'create_or_update_file') {
    const path = cleanPath(params.path);
    if (path.startsWith('.github/workflows/')) return { action, operationType: 'dangerous', label: '修改 workflow' };
    if (Boolean(params.bulk) || String(params.content || '').length > 200_000) {
      return { action, operationType: 'dangerous', label: '批量重写文件' };
    }
    if (!params.branch || String(params.branch).trim() === 'main' || params.direct_main === true) {
      return { action, operationType: 'dangerous', label: '直接推 main' };
    }
  }
  if (action === 'update_pr' && String(params.state || '') === 'closed') {
    return { action, operationType: 'dangerous', label: '关闭 PR' };
  }
  if (action === 'update_issue' && String(params.state || '') === 'closed') {
    return { action, operationType: 'dangerous', label: '关闭 issue' };
  }
  return { action, operationType: 'write', label: action };
}

export function enforceGitHubPolicy(settings, policy, input = {}) {
  if (policy.operationType === 'read') requireEnabled(settings, 'github_read', 'GitHub 读工具');
  else requireEnabled(settings, 'github_write', 'GitHub 写工具');
  if (policy.operationType === 'dangerous') requireEnabled(settings, 'github_dangerous', 'GitHub 危险动作');
  if (CI_ACTIONS.has(policy.action)) requireEnabled(settings, 'ci_actions', 'CI / Actions 工具');
  if (ARTIFACT_ACTIONS.has(policy.action)) requireEnabled(settings, 'apk_artifact', 'APK artifact 工具');
  return requireOperationConfirmation(policy.operationType, policy.label, input);
}

function simpleRepo(meta) {
  return {
    repo: meta.full_name,
    private: Boolean(meta.private),
    default_branch: meta.default_branch || null,
    pushed_at: meta.pushed_at || null,
    updated_at: meta.updated_at || null,
    visibility: meta.visibility || null,
  };
}
function simpleRun(run, repo) {
  return {
    repo,
    workflow_run_id: run.id,
    name: run.name || null,
    display_title: run.display_title || null,
    status: run.status || null,
    conclusion: run.conclusion || null,
    event: run.event || null,
    branch: run.head_branch || null,
    commit_sha: run.head_sha || null,
    run_number: run.run_number || null,
    created_at: run.created_at || null,
    updated_at: run.updated_at || null,
    html_url: run.html_url || null,
    head_commit_message: run.head_commit?.message || null,
  };
}
function simpleArtifact(artifact, repo) {
  return {
    repo,
    artifact_id: artifact.id,
    artifact_name: artifact.name,
    size_in_bytes: artifact.size_in_bytes,
    expired: Boolean(artifact.expired),
    created_at: artifact.created_at || null,
    expires_at: artifact.expires_at || null,
    updated_at: artifact.updated_at || null,
    digest: artifact.digest || null,
  };
}

function simpleReleaseAsset(asset, repo) {
  return {
    repo,
    release_asset_id: asset.id,
    name: asset.name || '',
    label: asset.label || null,
    state: asset.state || null,
    content_type: asset.content_type || null,
    size: Number(asset.size || 0),
    download_count: Number(asset.download_count || 0),
    created_at: asset.created_at || null,
    updated_at: asset.updated_at || null,
  };
}
function simpleRelease(release, repo) {
  return {
    repo,
    release_id: release.id,
    tag_name: release.tag_name || '',
    name: release.name || '',
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
    target_commitish: release.target_commitish || null,
    created_at: release.created_at || null,
    published_at: release.published_at || null,
    html_url: release.html_url || null,
    body: redactSecretText(release.body || '', 12000),
    assets: (release.assets || []).map((asset) => simpleReleaseAsset(asset, repo)),
  };
}
function simpleJob(job, { includeSteps = true } = {}) {
  return {
    job_id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    ...(includeSteps ? {
      steps: (job.steps || []).map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
        started_at: step.started_at || null,
        completed_at: step.completed_at || null,
      })),
    } : {}),
  };
}
function resultPage(data, itemsKey, page, perPage, mapper = (item) => item) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.[itemsKey]) ? data[itemsKey] : [];
  return { items: list.map(mapper), page, per_page: perPage, count: list.length };
}

export async function executeGitHubAction(env, actionValue, paramsValue = {}) {
  const params = paramsValue && typeof paramsValue === 'object' && !Array.isArray(paramsValue) ? paramsValue : {};
  const action = String(actionValue || '').trim();
  const repo = requireAllowedRepo(env, params.repo);
  const base = targetRepoPath(repo);
  const page = integer(params.page, 1, 1, 1000);
  const perPage = integer(params.per_page, 50, 1, 100);

  if (action === 'get_repo') return simpleRepo(await githubJson(env, base));
  if (action === 'list_branches') {
    const data = await githubJson(env, `${base}/branches${qs({ per_page: perPage, page })}`);
    return resultPage(data, '', page, perPage, (branch) => ({ name: branch.name, protected: Boolean(branch.protected), sha: branch.commit?.sha || null }));
  }
  if (action === 'read_file') {
    const path = cleanPath(params.path);
    const ref = cleanBranch(params.ref || params.branch || 'main');
    const data = await githubJson(env, `${base}/contents/${path.split('/').map(encoded).join('/')}${qs({ ref })}`);
    if (Array.isArray(data) || data.type !== 'file') throw new DevHandsError('github_not_file', '目标路径不是文件。', 400);
    const decoded = decodeGitHubFile(data);
    return {
      repo, path, ref, sha: data.sha || null, size: data.size || null, encoding: data.encoding || null,
      binary: decoded.binary, content: decoded.content, chars: decoded.chars || null,
      truncated: decoded.truncated || false,
      limit_chars: decoded.truncated ? MAX_FILE_CHARS : null,
    };
  }
  if (action === 'list_directory') {
    const path = String(params.path || '').replace(/^\/+/, '').trim();
    const ref = cleanBranch(params.ref || params.branch || 'main');
    const endpoint = path ? `${base}/contents/${path.split('/').map(encoded).join('/')}` : `${base}/contents`;
    const data = await githubJson(env, `${endpoint}${qs({ ref })}`);
    if (!Array.isArray(data)) throw new DevHandsError('github_not_directory', '目标路径不是目录。', 400);
    return {
      repo, path, ref,
      items: data.map((item) => ({ name: item.name, path: item.path, type: item.type, sha: item.sha, size: item.size || 0 })),
    };
  }
  if (action === 'search_code') {
    const query = String(params.query || '').trim();
    if (!query) throw new DevHandsError('query_required', '搜索代码需要 query。', 400);
    const data = await githubJson(env, `/search/code${qs({ q: `${query} repo:${repo}`, per_page: perPage, page })}`);
    return {
      repo, query, total_count: Number(data.total_count || 0), page, per_page: perPage,
      items: (data.items || []).map((item) => ({ name: item.name, path: item.path, sha: item.sha, html_url: item.html_url })),
    };
  }
  if (action === 'search_commits') {
    const query = String(params.query || '').trim();
    const endpoint = query
      ? `/search/commits${qs({ q: `${query} repo:${repo}`, per_page: perPage, page })}`
      : `${base}/commits${qs({ sha: params.branch || undefined, path: params.path || undefined, per_page: perPage, page })}`;
    const data = await githubJson(env, endpoint);
    const list = Array.isArray(data) ? data : data.items || [];
    return {
      repo, query, page, per_page: perPage,
      items: list.map((item) => ({
        sha: item.sha, message: item.commit?.message || null, html_url: item.html_url || null,
        author_date: item.commit?.author?.date || null, committer_date: item.commit?.committer?.date || null,
      })),
    };
  }
  if (action === 'get_commit') {
    const sha = String(params.sha || '').trim();
    if (!sha) throw new DevHandsError('commit_required', '需要 commit sha。', 400);
    const data = await githubJson(env, `${base}/commits/${encoded(sha)}`);
    return {
      repo, sha: data.sha, message: data.commit?.message || null, html_url: data.html_url || null,
      stats: data.stats || null,
      files: (data.files || []).map((file) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes })),
    };
  }
  if (action === 'compare_commits') {
    const baseRef = String(params.base || '').trim();
    const head = String(params.head || '').trim();
    if (!baseRef || !head) throw new DevHandsError('compare_refs_required', '比较 commit 需要 base 与 head。', 400);
    const data = await githubJson(env, `${base}/compare/${encoded(baseRef)}...${encoded(head)}`);
    return {
      repo, base: baseRef, head, status: data.status, ahead_by: data.ahead_by, behind_by: data.behind_by,
      total_commits: data.total_commits,
      files: (data.files || []).map((file) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes })),
    };
  }
  if (action === 'list_prs') {
    const data = await githubJson(env, `${base}/pulls${qs({ state: params.state || 'open', per_page: perPage, page })}`);
    return resultPage(data, '', page, perPage, (pr) => ({ pr_number: pr.number, title: pr.title, state: pr.state, draft: Boolean(pr.draft), branch: pr.head?.ref, base: pr.base?.ref, html_url: pr.html_url, updated_at: pr.updated_at }));
  }
  if (action === 'get_pr') {
    const number = requireNumber(params.pr_number, 'pr_number');
    const pr = await githubJson(env, `${base}/pulls/${number}`);
    return { repo, pr_number: number, title: pr.title, body: pr.body || '', state: pr.state, draft: Boolean(pr.draft), mergeable: pr.mergeable, merged: Boolean(pr.merged), branch: pr.head?.ref, base: pr.base?.ref, sha: pr.head?.sha, html_url: pr.html_url };
  }
  if (action === 'get_pr_diff') {
    const number = requireNumber(params.pr_number, 'pr_number');
    const response = await githubResponse(env, `${base}/pulls/${number}`, { raw: true, accept: 'application/vnd.github.diff' });
    const text = await response.text();
    return { repo, pr_number: number, diff: text.slice(0, MAX_LOG_CHARS), chars: text.length, truncated: text.length > MAX_LOG_CHARS, limit_chars: text.length > MAX_LOG_CHARS ? MAX_LOG_CHARS : null };
  }
  if (action === 'get_pr_files') {
    const number = requireNumber(params.pr_number, 'pr_number');
    const data = await githubJson(env, `${base}/pulls/${number}/files${qs({ per_page: perPage, page })}`);
    return resultPage(data, '', page, perPage, (file) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, sha: file.sha }));
  }
  if (action === 'get_issues') {
    const data = await githubJson(env, `${base}/issues${qs({ state: params.state || 'open', per_page: perPage, page })}`);
    return resultPage(data, '', page, perPage, (issue) => ({ issue_number: issue.number, title: issue.title, state: issue.state, is_pull_request: Boolean(issue.pull_request), html_url: issue.html_url, updated_at: issue.updated_at }));
  }
  if (action === 'get_issue') {
    const number = requireNumber(params.issue_number, 'issue_number');
    const issue = await githubJson(env, `${base}/issues/${number}`);
    return { repo, issue_number: number, title: issue.title, body: issue.body || '', state: issue.state, html_url: issue.html_url, labels: (issue.labels || []).map((item) => typeof item === 'string' ? item : item.name) };
  }
  if (action === 'list_workflow_runs') {
    const data = await githubJson(env, `${base}/actions/runs${qs({ branch: params.branch || undefined, status: params.status || undefined, event: params.event || undefined, per_page: perPage, page })}`);
    return { repo, page, per_page: perPage, total_count: Number(data.total_count || 0), items: (data.workflow_runs || []).map((run) => simpleRun(run, repo)) };
  }
  if (action === 'get_workflow_run') {
    const id = requireNumber(params.workflow_run_id, 'workflow_run_id');
    return simpleRun(await githubJson(env, `${base}/actions/runs/${id}`), repo);
  }
  if (action === 'get_workflow_jobs') {
    const id = requireNumber(params.workflow_run_id, 'workflow_run_id');
    const data = await githubJson(env, `${base}/actions/runs/${id}/jobs${qs({ per_page: perPage, page })}`);
    return {
      repo,
      workflow_run_id: id,
      page,
      per_page: perPage,
      total_count: Number(data.total_count || 0),
      jobs: (data.jobs || []).map((job) => simpleJob(job, { includeSteps: false })),
    };
  }
  if (action === 'get_job_steps') {
    const id = requireNumber(params.job_id, 'job_id');
    const job = await githubJson(env, `${base}/actions/jobs/${id}`);
    return { repo, ...simpleJob(job, { includeSteps: true }) };
  }
  if (action === 'get_job_logs') {
    const id = requireNumber(params.job_id, 'job_id');
    const raw = await githubText(env, `${base}/actions/jobs/${id}/logs`, { raw: true });
    const safe = redactSecretText(raw, MAX_LOG_CHARS);
    return { repo, job_id: id, logs: safe, chars: raw.length, truncated: raw.length > MAX_LOG_CHARS, limit_chars: raw.length > MAX_LOG_CHARS ? MAX_LOG_CHARS : null };
  }
  if (action === 'list_artifacts') {
    const runId = params.workflow_run_id ? requireNumber(params.workflow_run_id, 'workflow_run_id') : null;
    const endpoint = runId ? `${base}/actions/runs/${runId}/artifacts` : `${base}/actions/artifacts`;
    const data = await githubJson(env, `${endpoint}${qs({ per_page: perPage, page })}`);
    return { repo, workflow_run_id: runId, page, per_page: perPage, total_count: Number(data.total_count || 0), items: (data.artifacts || []).map((item) => simpleArtifact(item, repo)) };
  }
  if (action === 'get_artifact_metadata') {
    const id = requireNumber(params.artifact_id, 'artifact_id');
    return simpleArtifact(await githubJson(env, `${base}/actions/artifacts/${id}`), repo);
  }

  if (action === 'list_releases') {
    const data = await githubJson(env, `${base}/releases${qs({ per_page: perPage, page })}`);
    return resultPage(data, '', page, perPage, (release) => simpleRelease(release, repo));
  }
  if (action === 'get_release') {
    const id = requireNumber(params.release_id, 'release_id');
    return simpleRelease(await githubJson(env, `${base}/releases/${id}`), repo);
  }
  if (action === 'get_release_asset') {
    const id = requireNumber(params.release_asset_id, 'release_asset_id');
    return simpleReleaseAsset(await githubJson(env, `${base}/releases/assets/${id}`), repo);
  }
  if (action === 'list_deployments') {
    const data = await githubJson(env, `${base}/deployments${qs({ environment: params.environment || undefined, per_page: perPage, page })}`);
    return resultPage(data, '', page, perPage, (item) => ({ id: item.id, sha: item.sha, ref: item.ref, environment: item.environment, created_at: item.created_at, updated_at: item.updated_at }));
  }
  if (action === 'get_pages') {
    const pageData = await githubJson(env, `${base}/pages`);
    return { repo, status: pageData.status, cname: pageData.cname || null, html_url: pageData.html_url || null, build_type: pageData.build_type || null, source: pageData.source || null };
  }
  if (action === 'list_workflows') {
    const data = await githubJson(env, `${base}/actions/workflows${qs({ per_page: perPage, page })}`);
    return { repo, page, per_page: perPage, total_count: Number(data.total_count || 0), items: (data.workflows || []).map((item) => ({ id: item.id, name: item.name, path: item.path, state: item.state, html_url: item.html_url })) };
  }
  if (action === 'create_branch') {
    const name = cleanBranch(params.branch || params.branch_name, '');
    const from = cleanBranch(params.from || params.base || 'main');
    const source = await githubJson(env, `${base}/git/ref/heads/${encoded(from)}`);
    const created = await githubJson(env, `${base}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name}`, sha: source.object?.sha } });
    return { repo, branch: name, commit_sha: created.object?.sha || null };
  }
  if (action === 'create_or_update_file' || action === 'update_workflow_file') {
    const path = cleanPath(params.path);
    const branch = cleanBranch(params.branch || 'main');
    const content = String(params.content ?? '');
    const message = String(params.message || `Coast dev hand: update ${path}`).slice(0, 240);
    let sha = String(params.sha || '').trim();
    if (!sha) {
      try {
        const existing = await githubJson(env, `${base}/contents/${path.split('/').map(encoded).join('/')}${qs({ ref: branch })}`);
        if (!Array.isArray(existing) && existing?.sha) sha = existing.sha;
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
    }
    const data = await githubJson(env, `${base}/contents/${path.split('/').map(encoded).join('/')}`, { method: 'PUT', body: {
      message,
      content: utf8ToBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    } });
    return { repo, path, branch, sha: data.content?.sha || null, commit_sha: data.commit?.sha || null };
  }
  if (action === 'delete_file') {
    const path = cleanPath(params.path);
    const branch = cleanBranch(params.branch || 'main');
    let sha = String(params.sha || '').trim();
    if (!sha) {
      const existing = await githubJson(env, `${base}/contents/${path.split('/').map(encoded).join('/')}${qs({ ref: branch })}`);
      sha = existing?.sha || '';
    }
    if (!sha) throw new DevHandsError('file_sha_required', '删除文件需要当前 sha。', 400);
    const data = await githubJson(env, `${base}/contents/${path.split('/').map(encoded).join('/')}`, { method: 'DELETE', body: {
      message: String(params.message || `Coast dev hand: delete ${path}`).slice(0, 240), branch, sha,
    } });
    return { repo, path, branch, commit_sha: data.commit?.sha || null, deleted: true };
  }
  if (action === 'create_pr') {
    const head = cleanBranch(params.head || params.branch, '');
    const baseRef = cleanBranch(params.base || 'main');
    const data = await githubJson(env, `${base}/pulls`, { method: 'POST', body: {
      title: String(params.title || `Coast dev hand: ${head}`).slice(0, 240),
      head,
      base: baseRef,
      body: String(params.body || ''),
      draft: Boolean(params.draft),
    } });
    return { repo, pr_number: data.number, title: data.title, branch: data.head?.ref, base: data.base?.ref, html_url: data.html_url };
  }
  if (action === 'update_pr') {
    const number = requireNumber(params.pr_number, 'pr_number');
    const payload = {};
    if (params.title != null) payload.title = String(params.title).slice(0, 240);
    if (params.body != null) payload.body = String(params.body);
    if (params.state != null) payload.state = String(params.state);
    if (params.base != null) payload.base = cleanBranch(params.base);
    const data = await githubJson(env, `${base}/pulls/${number}`, { method: 'PATCH', body: payload });
    return { repo, pr_number: number, title: data.title, state: data.state, branch: data.head?.ref, base: data.base?.ref, html_url: data.html_url };
  }
  if (action === 'comment_pr') {
    const number = requireNumber(params.pr_number, 'pr_number');
    const data = await githubJson(env, `${base}/issues/${number}/comments`, { method: 'POST', body: { body: String(params.body || params.comment || '') } });
    return { repo, pr_number: number, comment_id: data.id, html_url: data.html_url };
  }
  if (action === 'create_issue') {
    const data = await githubJson(env, `${base}/issues`, { method: 'POST', body: { title: String(params.title || '').slice(0, 240), body: String(params.body || '') } });
    return { repo, issue_number: data.number, title: data.title, html_url: data.html_url };
  }
  if (action === 'update_issue') {
    const number = requireNumber(params.issue_number, 'issue_number');
    const payload = {};
    if (params.title != null) payload.title = String(params.title).slice(0, 240);
    if (params.body != null) payload.body = String(params.body);
    if (params.state != null) payload.state = String(params.state);
    const data = await githubJson(env, `${base}/issues/${number}`, { method: 'PATCH', body: payload });
    return { repo, issue_number: number, title: data.title, state: data.state, html_url: data.html_url };
  }
  if (action === 'add_issue_comment') {
    const number = requireNumber(params.issue_number, 'issue_number');
    const data = await githubJson(env, `${base}/issues/${number}/comments`, { method: 'POST', body: { body: String(params.body || params.comment || '') } });
    return { repo, issue_number: number, comment_id: data.id, html_url: data.html_url };
  }
  if (action === 'rerun_failed_jobs') {
    const id = requireNumber(params.workflow_run_id, 'workflow_run_id');
    await githubJson(env, `${base}/actions/runs/${id}/rerun-failed-jobs`, { method: 'POST' });
    return { repo, workflow_run_id: id, rerun: 'failed_jobs' };
  }
  if (action === 'rerun_job') {
    const id = requireNumber(params.job_id, 'job_id');
    await githubJson(env, `${base}/actions/jobs/${id}/rerun`, { method: 'POST' });
    return { repo, job_id: id, rerun: 'job' };
  }
  if (action === 'merge_pr') {
    const number = requireNumber(params.pr_number, 'pr_number');
    const data = await githubJson(env, `${base}/pulls/${number}/merge`, { method: 'PUT', body: {
      merge_method: ['merge', 'squash', 'rebase'].includes(params.merge_method) ? params.merge_method : 'squash',
      ...(params.commit_title ? { commit_title: String(params.commit_title).slice(0, 240) } : {}),
      ...(params.commit_message ? { commit_message: String(params.commit_message) } : {}),
      ...(params.sha ? { sha: String(params.sha) } : {}),
    } });
    return { repo, pr_number: number, merged: Boolean(data.merged), commit_sha: data.sha || null, message: data.message || null };
  }
  if (action === 'create_deployment_status') {
    const id = requireNumber(params.deployment_id, 'deployment_id');
    const data = await githubJson(env, `${base}/deployments/${id}/statuses`, { method: 'POST', body: {
      state: String(params.state || ''),
      description: String(params.description || '').slice(0, 240),
      environment: String(params.environment || '').slice(0, 120) || undefined,
      log_url: String(params.log_url || '') || undefined,
    } });
    return { repo, deployment_id: id, deployment_status_id: data.id, state: data.state, environment: data.environment || null };
  }
  if (action === 'update_pages') {
    const data = await githubJson(env, `${base}/pages`, { method: 'PUT', body: params.config && typeof params.config === 'object' ? params.config : {} });
    return { repo, status: data.status || null, cname: data.cname || null, html_url: data.html_url || null };
  }
  throw new DevHandsError('unknown_github_action', '未知 GitHub 开发手动作。', 400);
}
