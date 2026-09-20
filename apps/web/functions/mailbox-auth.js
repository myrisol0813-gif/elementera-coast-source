const COOKIE_NAME = '__Host-coast_mailbox';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
// Cloudflare Workers rejects PBKDF2 requests above 100,000 iterations.
// The server-keyed HMAC material below adds a pepper before the capped KDF.
const PBKDF2_ITERATIONS = 100000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sessionSecret(env) {
  const secret = env?.COAST_SESSION_SECRET;
  return typeof secret === 'string' && secret.length >= 32 ? secret : '';
}

function encodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBytes(value) {
  const text = String(value || '');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmac(value, secret) {
  const bytes = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(value));
  return new Uint8Array(bytes);
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function normalizePassphrase(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

export async function passphraseLookup(value, env) {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('mailbox_auth_not_configured');
  const passphrase = normalizePassphrase(value);
  return encodeBytes(await hmac(`mailbox-passphrase-lookup\n${passphrase}`, secret));
}

async function derivePassphrase(passphrase, salt, env, iterations = PBKDF2_ITERATIONS) {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('mailbox_auth_not_configured');
  const material = await hmac(`mailbox-passphrase-hash\n${passphrase}`, secret);
  const key = await crypto.subtle.importKey(
    'raw',
    material,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations,
  }, key, 256);
  return new Uint8Array(bits);
}

export async function createPassphraseHash(value, env) {
  const passphrase = normalizePassphrase(value);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassphrase(passphrase, salt, env);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${encodeBytes(salt)}$${encodeBytes(derived)}`;
}

export async function verifyPassphraseHash(value, storedHash, env) {
  const [algorithm, iterationsText, saltText, hashText] = String(storedHash || '').split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2-sha256'
    || iterations !== PBKDF2_ITERATIONS
    || !saltText
    || !hashText) return false;
  try {
    const expected = decodeBytes(hashText);
    const actual = await derivePassphrase(
      normalizePassphrase(value),
      decodeBytes(saltText),
      env,
      iterations,
    );
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}

async function signSession(payload, secret) {
  return encodeBytes(await hmac(`mailbox-session\n${payload}`, secret));
}

export async function createMailboxSession(visitorId, env) {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('mailbox_auth_not_configured');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encodeBytes(encoder.encode(JSON.stringify({
    v: 1,
    kind: 'mailbox_visitor',
    visitor_id: String(visitorId || ''),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  })));
  return `${payload}.${await signSession(payload, secret)}`;
}

export async function verifyMailboxSession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const token = parseCookies(request.headers.get('Cookie')).get(COOKIE_NAME);
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 2 || !segments[0] || !segments[1]) return null;
  const [payload, signature] = segments;
  let signatureBytes;
  try {
    signatureBytes = decodeBytes(signature);
    if (encodeBytes(signatureBytes) !== signature) return null;
  } catch {
    return null;
  }
  const expected = await hmac(`mailbox-session\n${payload}`, secret);
  if (!equalBytes(signatureBytes, expected)) return null;
  try {
    const payloadBytes = decodeBytes(payload);
    if (encodeBytes(payloadBytes) !== payload) return null;
    const session = JSON.parse(decoder.decode(payloadBytes));
    const now = Math.floor(Date.now() / 1000);
    if (session.v !== 1
      || session.kind !== 'mailbox_visitor'
      || typeof session.visitor_id !== 'string'
      || !session.visitor_id
      || !Number.isFinite(session.exp)
      || session.exp <= now) return null;
    return Object.freeze(session);
  } catch {
    return null;
  }
}

export function mailboxSessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearMailboxSessionCookie() {
  return mailboxSessionCookie('', 0);
}
