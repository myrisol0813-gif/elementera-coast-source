export class DevHandsError extends Error {
  constructor(type, message, status = 400, details = {}) {
    super(message);
    this.name = 'DevHandsError';
    this.type = type;
    this.status = status;
    this.details = details && typeof details === 'object' ? details : {};
  }
}

export const WRITE_CONFIRM_PREFIX = '确认写入：';
export const DANGER_CONFIRM_PREFIX = '确认执行危险动作：';

export function requireEnabled(settings, key, label = key) {
  if (settings?.[key] === true) return;
  throw new DevHandsError('dev_tool_disabled', `${label}当前处于关闭状态。`, 403, { setting: key });
}

export function confirmationFor(operationType, label) {
  if (operationType === 'dangerous') return `${DANGER_CONFIRM_PREFIX}${label}`;
  if (operationType === 'write') return `${WRITE_CONFIRM_PREFIX}${label}`;
  return '';
}

export function requireOperationConfirmation(operationType, label, input = {}) {
  if (!['write', 'dangerous'].includes(operationType)) {
    return { required: false, confirmed: false, expected: '' };
  }
  const expected = confirmationFor(operationType, label);
  const provided = String(input.confirm_text || '').trim();
  if (provided !== expected) {
    throw new DevHandsError(
      operationType === 'dangerous' ? 'dangerous_confirmation_required' : 'write_confirmation_required',
      operationType === 'dangerous' ? '这个动作需要强确认。' : '这个写操作需要确认。',
      409,
      { confirmation_text: expected, operation_type: operationType, action_label: label },
    );
  }
  return { required: true, confirmed: true, expected };
}

export function cleanRepo(value) {
  const repo = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) {
    throw new DevHandsError('invalid_repo', '仓库名称格式无效。', 400);
  }
  return repo;
}

export function allowedRepos(env) {
  return [...new Set(String(env?.COAST_GITHUB_ALLOWED_REPOS || '')
    .split(/[\n,]+/u)
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(item)))];
}

export function requireAllowedRepo(env, value) {
  const repo = cleanRepo(value);
  const allowed = allowedRepos(env);
  if (!allowed.includes(repo)) {
    throw new DevHandsError('repo_not_allowed', '这个仓库不在开发手 allowlist 中。', 403, { repo, allowed_repos: allowed });
  }
  return repo;
}

export function requireServerSecret(env, key, label) {
  const present = typeof env?.[key] === 'string' && env[key].trim().length > 0;
  if (!present) throw new DevHandsError('dev_secret_missing', `${label}尚未配置。`, 503, { secret_present: false });
  return env[key].trim();
}
