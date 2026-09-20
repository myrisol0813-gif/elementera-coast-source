import { redirect, securityHeaders, text } from './http.js';

const COOKIE_NAME = '__Host-elementera_source_owner';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sessionSecret(env) {
  const value = env?.COAST_SESSION_SECRET;
  return typeof value === 'string' && value.length >= 32 ? value : '';
}
function accessPassword(env) {
  const value = env?.SOURCE_ACCESS_PASSWORD;
  return typeof value === 'string' && value.length >= 8 ? value : '';
}
function encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decode(value) {
  const raw = String(value || '');
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function cookies(request) {
  const result = new Map();
  for (const part of String(request.headers.get('Cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return result;
}
async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(value, secret) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(value)));
}
function equal(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
async function makeSession(env) {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('owner_auth_not_configured');
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(encoder.encode(JSON.stringify({ v: 1, kind: 'owner', iat: now, exp: now + SESSION_SECONDS })));
  return `${payload}.${encode(await sign(`owner-session\n${payload}`, secret))}`;
}
export async function verifySession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const value = cookies(request).get(COOKIE_NAME);
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  try {
    const actual = decode(signature);
    const expected = await sign(`owner-session\n${payload}`, secret);
    if (!equal(actual, expected)) return null;
    const session = JSON.parse(decoder.decode(decode(payload)));
    if (session?.v !== 1 || session?.kind !== 'owner' || Number(session.exp) <= Math.floor(Date.now() / 1000)) return null;
    return Object.freeze(session);
  } catch {
    return null;
  }
}
function cookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
function loginPage(message = '') {
  const error = message ? `<p class="login-error">${String(message).replace(/[<>&"]/g, '')}</p>` : '';
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<title>Elementera Coast Source</title>
<link rel="stylesheet" href="/public/styles/tokens.css">
<link rel="stylesheet" href="/public/styles/shell.css">
<link rel="stylesheet" href="/public/styles/mailbox.css">
</head>
<body>
<main class="login-page">
  <section class="login-card">
    <div class="login-logo" aria-hidden="true">⌂</div>
    <h1>Elementera Coast Source</h1>
    <p>进入你的长期对话空间</p>
    ${error}
    <form method="post" action="/login">
      <label>输入访问密码<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">进入</button>
    </form>
    <button id="mailboxEntryButton" type="button">访客信箱</button>
  </section>
  <dialog id="mailboxEntryModal" class="mailbox-entry-modal" data-mailbox-pane="choices">
    <button id="mailboxEntryClose" type="button" aria-label="关闭">×</button>
    <h2 id="mailbox-entry-title">访客信箱</h2>
    <div id="mailboxEntryChoices">
      <button type="button" data-mailbox-choice="login">已有暗号</button>
      <button type="button" data-mailbox-choice="register">第一次来访</button>
    </div>
    <form id="mailboxLoginForm" hidden>
      <label>暗号<input name="passphrase" type="password" required></label>
      <p data-mailbox-error></p>
      <button type="submit">进入访客信箱</button><button type="button" data-mailbox-back>返回</button>
    </form>
    <form id="mailboxRegisterForm" hidden>
      <label>显示名<input name="display_name" maxlength="80" required></label>
      <label>暗号<input name="passphrase" type="password" required></label>
      <label>希望另一位屋主怎么称呼我（可选）<input name="preferred_name" maxlength="80"></label>
      <label><input name="allow_memory" type="checkbox">允许另一位屋主在我的「访客记事本」里记住少量偏好</label>
      <p data-mailbox-error></p>
      <button type="submit">建立访客信箱</button><button type="button" data-mailbox-back>返回</button>
    </form>
  </dialog>
<script type="module" src="/public/mailbox-entry.js"></script>
</main>
</body></html>`;
}
export async function handleLogin(request, env) {
  if (request.method === 'GET') return text(loginPage(), 200, { 'Content-Type': 'text/html; charset=UTF-8' });
  if (request.method !== 'POST') return text('Method not allowed.', 405);
  const configuredPassword = accessPassword(env);
  if (!configuredPassword || !sessionSecret(env)) {
    return text(loginPage('Source owner access is not configured.'), 503, { 'Content-Type': 'text/html; charset=UTF-8' });
  }
  const form = await request.formData();
  const supplied = String(form.get('password') || '');
  if (supplied !== configuredPassword) return text(loginPage('访问密码不正确。'), 401, { 'Content-Type': 'text/html; charset=UTF-8' });
  const session = await makeSession(env);
  return redirect('/', { 'Set-Cookie': cookie(session) });
}
export function handleLogout() {
  return redirect('/login', { 'Set-Cookie': cookie('', 0) });
}
export function unauthorized() {
  return redirect('/login');
}
