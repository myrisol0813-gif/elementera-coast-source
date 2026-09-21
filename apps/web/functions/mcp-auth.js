const jwksByIssuer = new Map();
const JWKS_CACHE_MS = 10 * 60_000;
const JWKS_REFRESH_COOLDOWN_MS = 30_000;
const MAX_TOKEN_LENGTH = 24_000;
const EMAIL_CLAIM_DEFAULT = 'https://elementera-coast-source.invalid/email';
const EMAIL_VERIFIED_CLAIM_DEFAULT = 'https://elementera-coast-source.invalid/email_verified';
export const MCP_SCOPES = Object.freeze([
  'read:coast',
  'write:soil',
  'write:radio',
  'write:lighthouse',
]);

export class McpAuthError extends Error {
  constructor(type, message, status = 401, details = {}) {
    super(message);
    this.name = 'McpAuthError';
    this.type = type;
    this.status = status;
    this.details = details;
    this.failureCode = details.failure_code || null;
  }
}

function createAuthDiagnostic(request, requiredScopes = []) {
  return {
    authorization_header_present: Boolean(request?.headers?.has('Authorization')),
    bearer_scheme_present: false,
    required_scopes: [...requiredScopes],
    actual_scopes: [],
    jwt_verified: null,
    jwt_verify_reason: null,
    token_dot_count: null,
    jwt_header_alg: null,
    jwt_header_kid_present: null,
    unverified_payload_iss_matches_expected: null,
    unverified_payload_aud_matches_expected: null,
    unverified_payload_scope_present: null,
    verify_exception_name: null,
    jwks_failure_reason: null,
    jwks_url_valid: null,
    jwks_http_status: null,
    jwks_fetch_exception_name: null,
    jwks_usable_key_count: null,
    claim_checks: {
      iss_matches: null,
      aud_matches: null,
      token_expired: null,
      sub_allowed: null,
      email_allowed: null,
      email_verified: null,
    },
  };
}

function diagnosticSnapshot(value) {
  return {
    authorization_header_present: Boolean(value.authorization_header_present),
    bearer_scheme_present: Boolean(value.bearer_scheme_present),
    required_scopes: [...value.required_scopes],
    actual_scopes: [...value.actual_scopes],
    jwt_verified: value.jwt_verified,
    jwt_verify_reason: value.jwt_verify_reason,
    token_dot_count: value.token_dot_count,
    jwt_header_alg: value.jwt_header_alg,
    jwt_header_kid_present: value.jwt_header_kid_present,
    unverified_payload_iss_matches_expected: value.unverified_payload_iss_matches_expected,
    unverified_payload_aud_matches_expected: value.unverified_payload_aud_matches_expected,
    unverified_payload_scope_present: value.unverified_payload_scope_present,
    verify_exception_name: value.verify_exception_name,
    jwks_failure_reason: value.jwks_failure_reason,
    jwks_url_valid: value.jwks_url_valid,
    jwks_http_status: value.jwks_http_status,
    jwks_fetch_exception_name: value.jwks_fetch_exception_name,
    jwks_usable_key_count: value.jwks_usable_key_count,
    claim_checks: { ...value.claim_checks },
  };
}

function authFailure(failureCode, message, status, diagnostic, extra = {}) {
  const type = failureCode === 'scope_missing'
    ? 'insufficient_scope'
    : failureCode === 'subject_not_allowed'
      ? 'mcp_subject_denied'
      : ['email_not_allowed', 'email_not_verified'].includes(failureCode)
        ? 'mcp_email_denied'
        : 'invalid_access_token';
  return new McpAuthError(type, message, status, {
    ...extra,
    failure_code: failureCode,
    auth_diagnostic: diagnosticSnapshot(diagnostic),
  });
}

function safeExceptionName(error) {
  const value = String(error?.name || '').trim();
  if (!value) return null;
  return /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value) ? value : 'OtherError';
}

function jwtFailure(reason, message, diagnostic, { status = 401, exception = null } = {}) {
  diagnostic.jwt_verify_reason = reason;
  diagnostic.verify_exception_name = safeExceptionName(exception);
  return authFailure('jwt_verify_failed', message, status, diagnostic);
}

function jwksFailure(reason, message, diagnostic, { httpStatus = null, exception = null } = {}) {
  diagnostic.jwks_failure_reason = reason;
  diagnostic.jwks_http_status = Number.isInteger(httpStatus) ? httpStatus : diagnostic.jwks_http_status;
  diagnostic.jwks_fetch_exception_name = safeExceptionName(exception);
  return jwtFailure('jwks_fetch_failed', message, diagnostic, { exception });
}

function safeJwtAlg(value) {
  const algorithm = typeof value === 'string' ? value.trim() : '';
  if (!algorithm) return null;
  return /^[A-Za-z0-9_-]{1,16}$/.test(algorithm) ? algorithm : 'other';
}

function splitList(value, { lowercase = false } = {}) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => lowercase ? item.toLocaleLowerCase('en-US') : item);
}

function issuerUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new McpAuthError('mcp_auth_not_configured', 'MCP OAuth issuer 未配置。', 503);
  }
  if (url.protocol !== 'https:') throw new McpAuthError('mcp_auth_not_configured', 'MCP OAuth issuer 必须使用 HTTPS。', 503);
  url.hash = '';
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

export function mcpAuthConfig(env = {}) {
  const issuer = issuerUrl(env.COAST_MCP_AUTH0_ISSUER);
  const audience = String(env.COAST_MCP_AUTH0_AUDIENCE || '').trim();
  const allowedSubjects = splitList(env.COAST_MCP_ALLOWED_SUBJECTS);
  const allowedEmails = splitList(env.COAST_MCP_ALLOWED_EMAILS, { lowercase: true });
  const emailClaim = String(env.COAST_MCP_EMAIL_CLAIM || EMAIL_CLAIM_DEFAULT).trim();
  const emailVerifiedClaim = String(env.COAST_MCP_EMAIL_VERIFIED_CLAIM || EMAIL_VERIFIED_CLAIM_DEFAULT).trim();
  if (!audience || !allowedSubjects.length || !allowedEmails.length || !emailClaim || !emailVerifiedClaim) {
    throw new McpAuthError(
      'mcp_auth_not_configured',
      'MCP OAuth 的 audience、允许 subject、允许 email 或 email claim 尚未完整配置。',
      503,
    );
  }
  return Object.freeze({
    issuer,
    audience,
    allowedSubjects: new Set(allowedSubjects),
    allowedEmails: new Set(allowedEmails),
    emailClaim,
    emailVerifiedClaim,
  });
}

function bearerToken(request, diagnostic) {
  const authorization = request.headers.get('Authorization');
  if (authorization == null) {
    throw authFailure(
      'missing_authorization_header',
      '需要连接屋主的海岸账号。',
      401,
      diagnostic,
    );
  }
  diagnostic.bearer_scheme_present = /^Bearer(?:\s|$)/i.test(authorization);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw authFailure(
      'malformed_bearer_token',
      '海岸连接的 Authorization 格式无效。',
      401,
      diagnostic,
    );
  }
  const token = match[1].trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw authFailure(
      'malformed_bearer_token',
      '海岸连接的 Bearer token 格式无效。',
      401,
      diagnostic,
    );
  }
  return token;
}

function scopesFromClaims(payload) {
  return new Set(String(payload.scope || '').split(/\s+/).filter(Boolean));
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new McpAuthError('invalid_access_token', '海岸连接令牌无效或已经过期。', 401);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError();
    return parsed;
  } catch (error) {
    if (error instanceof McpAuthError) throw error;
    throw new McpAuthError('invalid_access_token', '海岸连接令牌无效或已经过期。', 401);
  }
}

function populateUnverifiedJwtDiagnostic(payload, config, diagnostic) {
  const audience = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud || '')];
  diagnostic.unverified_payload_iss_matches_expected = payload.iss === config.issuer;
  diagnostic.unverified_payload_aud_matches_expected = audience.includes(config.audience);
  diagnostic.unverified_payload_scope_present = typeof payload.scope === 'string'
    && Boolean(payload.scope.trim());
}

function populateVerifiedClaimDiagnostic(payload, config, diagnostic) {
  const audience = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud || '')];
  const subject = String(payload?.sub || '').trim();
  const email = String(payload?.[config.emailClaim] || payload?.email || '').trim().toLocaleLowerCase('en-US');
  diagnostic.actual_scopes = [...scopesFromClaims(payload)].sort();
  diagnostic.claim_checks.iss_matches = payload.iss === config.issuer;
  diagnostic.claim_checks.aud_matches = audience.includes(config.audience);
  diagnostic.claim_checks.token_expired = Number.isFinite(payload.exp)
    ? payload.exp <= Date.now() / 1000 - 5
    : null;
  diagnostic.claim_checks.sub_allowed = Boolean(subject && config.allowedSubjects.has(subject));
  diagnostic.claim_checks.email_allowed = Boolean(email && config.allowedEmails.has(email));
  diagnostic.claim_checks.email_verified = payload?.[config.emailVerifiedClaim] === true
    || payload?.email_verified === true;
}

function validateRegisteredClaims(payload, config, diagnostic) {
  const now = Date.now() / 1000;
  if (!diagnostic.claim_checks.iss_matches) {
    throw authFailure('issuer_mismatch', '海岸连接令牌的 issuer 不匹配。', 401, diagnostic);
  }
  if (!diagnostic.claim_checks.aud_matches) {
    throw authFailure('audience_mismatch', '海岸连接令牌的 audience 不匹配。', 401, diagnostic);
  }
  if (!Number.isFinite(payload.exp)) {
    throw jwtFailure('invalid_exp', '海岸连接令牌缺少有效过期时间。', diagnostic);
  }
  if (diagnostic.claim_checks.token_expired) {
    throw authFailure('expired_token', '海岸连接令牌已经过期。', 401, diagnostic);
  }
  if (payload.nbf != null && (!Number.isFinite(payload.nbf) || payload.nbf > now + 5)) {
    throw jwtFailure('token_not_yet_valid', '海岸连接令牌尚未生效。', diagnostic);
  }
  if (payload.iat != null && (!Number.isFinite(payload.iat) || payload.iat > now + 60)) {
    throw jwtFailure('invalid_iat', '海岸连接令牌签发时间无效。', diagnostic);
  }
}

export function validateMcpClaims(
  payload,
  config,
  requiredScopes = [],
  diagnostic = createAuthDiagnostic(null, requiredScopes),
) {
  const subject = String(payload?.sub || '').trim();
  const email = String(payload?.[config.emailClaim] || payload?.email || '').trim().toLocaleLowerCase('en-US');
  const emailVerified = payload?.[config.emailVerifiedClaim] === true || payload?.email_verified === true;
  const scopes = scopesFromClaims(payload);
  diagnostic.actual_scopes = [...scopes].sort();
  diagnostic.claim_checks.sub_allowed = Boolean(subject && config.allowedSubjects.has(subject));
  diagnostic.claim_checks.email_allowed = Boolean(email && config.allowedEmails.has(email));
  diagnostic.claim_checks.email_verified = emailVerified;
  if (!diagnostic.claim_checks.sub_allowed) {
    throw authFailure(
      'subject_not_allowed',
      '这个 Auth0 身份不在海岸邀请名单中。',
      403,
      diagnostic,
    );
  }
  if (!diagnostic.claim_checks.email_allowed) {
    throw authFailure(
      'email_not_allowed',
      '这个邮箱身份不在海岸邀请名单中。',
      403,
      diagnostic,
    );
  }
  if (!diagnostic.claim_checks.email_verified) {
    throw authFailure(
      'email_not_verified',
      '这个邮箱身份尚未通过验证。',
      403,
      diagnostic,
    );
  }
  const missing = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missing.length) {
    throw authFailure(
      'scope_missing',
      '当前连接缺少所需海岸权限。',
      403,
      diagnostic,
      { missing_scopes: missing },
    );
  }
  return Object.freeze({
    subject,
    email,
    scopes,
  });
}

function jwksUrlForIssuer(issuer, diagnostic) {
  const normalizedIssuer = String(issuer || '').replace(/\/+$/, '');
  const value = `${normalizedIssuer}/.well-known/jwks.json`;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    diagnostic.jwks_url_valid = false;
    throw jwksFailure(
      'jwks_url_invalid',
      'Auth0 JWKS 地址无效。',
      diagnostic,
      { exception: error },
    );
  }
  const valid = url.protocol === 'https:'
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && url.pathname.endsWith('/.well-known/jwks.json');
  diagnostic.jwks_url_valid = valid;
  if (!valid) {
    throw jwksFailure('jwks_url_invalid', 'Auth0 JWKS 地址无效。', diagnostic);
  }
  return url.href;
}

async function remoteJwks(issuer, diagnostic, { refresh = false } = {}) {
  const cached = jwksByIssuer.get(issuer);
  if (!refresh && cached && cached.expires_at > Date.now()) return cached;
  if (refresh && cached && cached.refreshed_at + JWKS_REFRESH_COOLDOWN_MS > Date.now()) return cached;
  const jwksUrl = jwksUrlForIssuer(issuer, diagnostic);
  let response;
  try {
    response = await fetch(jwksUrl, {
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw jwksFailure(
      'jwks_fetch_exception_name',
      '暂时无法读取海岸身份签名密钥。',
      diagnostic,
      { exception: error },
    );
  }
  diagnostic.jwks_http_status = response.status;
  if (!response.ok) {
    throw jwksFailure(
      'jwks_http_status',
      'Auth0 JWKS 请求返回了失败状态。',
      diagnostic,
      { httpStatus: response.status },
    );
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw jwksFailure(
      'jwks_json_parse_failed',
      '海岸身份签名密钥响应格式无效。',
      diagnostic,
      { exception: error },
    );
  }
  const keys = Array.isArray(body?.keys)
    ? body.keys.filter((key) => key?.kty === 'RSA' && key?.kid && (!key.use || key.use === 'sig'))
    : [];
  diagnostic.jwks_usable_key_count = keys.length;
  if (!keys.length) {
    throw jwksFailure('jwks_empty_keys', 'Auth0 JWKS 没有可用的 RSA 签名密钥。', diagnostic);
  }
  const value = {
    keys,
    imported: new Map(),
    refreshed_at: Date.now(),
    expires_at: Date.now() + JWKS_CACHE_MS,
  };
  jwksByIssuer.set(issuer, value);
  return value;
}

async function verifyMcpToken(token, config, diagnostic) {
  diagnostic.jwt_verified = false;
  diagnostic.token_dot_count = [...token].filter((character) => character === '.').length;
  const segments = token.split('.');
  if (segments.length !== 3) {
    const reason = diagnostic.token_dot_count === 0
      ? 'token_not_jwt'
      : diagnostic.token_dot_count === 4
        ? 'token_is_jwe_or_opaque'
        : 'token_segment_count';
    throw jwtFailure(reason, '海岸连接令牌不是可验证的三段 JWT。', diagnostic);
  }
  if (segments.some((segment) => !segment)) {
    throw jwtFailure('token_not_jwt', '海岸连接令牌不是完整的三段 JWT。', diagnostic);
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  let header;
  try {
    header = decodeJsonSegment(encodedHeader);
  } catch (error) {
    throw jwtFailure(
      'jwt_header_decode_failed',
      '海岸连接令牌的 JWT header 无法解析。',
      diagnostic,
      { exception: error },
    );
  }
  diagnostic.jwt_header_alg = safeJwtAlg(header.alg);
  diagnostic.jwt_header_kid_present = typeof header.kid === 'string' && Boolean(header.kid.trim());
  let payload;
  try {
    payload = decodeJsonSegment(encodedPayload);
  } catch (error) {
    throw jwtFailure(
      'jwt_payload_decode_failed',
      '海岸连接令牌的 JWT payload 无法解析。',
      diagnostic,
      { exception: error },
    );
  }
  populateUnverifiedJwtDiagnostic(payload, config, diagnostic);
  if (header.alg !== 'RS256') {
    throw jwtFailure('unsupported_alg', '海岸连接令牌不是受支持的 RS256 JWT。', diagnostic);
  }
  if (!diagnostic.jwt_header_kid_present) {
    throw jwtFailure('missing_kid', '海岸连接令牌缺少签名密钥标识。', diagnostic);
  }
  let jwks = await remoteJwks(config.issuer, diagnostic);
  let jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    jwks = await remoteJwks(config.issuer, diagnostic, { refresh: true });
    jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!jwk || (jwk.alg && jwk.alg !== 'RS256')) {
    throw jwtFailure('no_matching_jwk', '没有匹配 JWT kid 的 Auth0 签名密钥。', diagnostic);
  }
  let publicKey = jwks.imported.get(header.kid);
  if (!publicKey) {
    try {
      publicKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
    } catch (error) {
      throw jwtFailure(
        'jwk_import_failed',
        'Auth0 签名密钥无法用于 JWT 验证。',
        diagnostic,
        { exception: error },
      );
    }
    jwks.imported.set(header.kid, publicKey);
  }
  let signature;
  try {
    signature = decodeBase64Url(encodedSignature);
  } catch (error) {
    throw jwtFailure(
      'signature_decode_failed',
      '海岸连接令牌签名格式无效。',
      diagnostic,
      { exception: error },
    );
  }
  let verified;
  try {
    verified = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch (error) {
    throw jwtFailure(
      'verify_exception',
      '海岸连接令牌验签过程异常。',
      diagnostic,
      { exception: error },
    );
  }
  if (!verified) {
    throw jwtFailure(
      'signature_invalid',
      '海岸连接令牌签名验证失败。',
      diagnostic,
    );
  }
  diagnostic.jwt_verified = true;
  populateVerifiedClaimDiagnostic(payload, config, diagnostic);
  validateRegisteredClaims(payload, config, diagnostic);
  return payload;
}

export async function requireMcpAuth(request, env, requiredScopes = []) {
  const diagnostic = createAuthDiagnostic(request, requiredScopes);
  try {
    const token = bearerToken(request, diagnostic);
    const config = mcpAuthConfig(env);
    const payload = await verifyMcpToken(token, config, diagnostic);
    return validateMcpClaims(payload, config, requiredScopes, diagnostic);
  } catch (error) {
    if (error instanceof McpAuthError && error.failureCode) throw error;
    throw jwtFailure(
      diagnostic.jwt_verify_reason || 'verify_exception',
      error?.status === 503 ? 'MCP OAuth 验证暂时不可用。' : '海岸连接令牌验证失败。',
      diagnostic,
      {
        status: error?.status === 503 ? 503 : 401,
        exception: error,
      },
    );
  }
}

export function mcpResourceMetadata(request, env) {
  const config = mcpAuthConfig(env);
  const origin = new URL(request.url).origin;
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [config.issuer],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/mcp/manifest`,
  };
}

export function mcpAuthChallenge(request, error, scopes = []) {
  const origin = new URL(request.url).origin;
  const code = error?.failureCode === 'scope_missing' ? 'insufficient_scope' : 'invalid_token';
  const description = String(error?.message || 'Authorization required').replace(/["\\\r\n]/g, ' ').slice(0, 180);
  const scope = scopes.length ? `, scope="${scopes.join(' ')}"` : '';
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="${code}", error_description="${description}"${scope}`;
}
