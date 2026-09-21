import { json, readText, redirect, securityHeaders, text } from './http.js';

const COOKIE_NAME = '__Host-coast_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;
const MAX_LOGIN_BODY_BYTES = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function passwordHash(env) {
  return String(env.COAST_PASSWORD_HASH || '').trim().toLowerCase().replace(/^sha256:/, '');
}

function sessionSecret(env) {
  return env.COAST_SESSION_SECRET;
}

function configured(env) {
  return /^[a-f0-9]{64}$/.test(passwordHash(env))
    && typeof sessionSecret(env) === 'string'
    && sessionSecret(env).length >= 32;
}

function loginRequestAllowed(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null') return origin === requestOrigin;
  const referer = request.headers.get('Referer');
  if (!referer) return true;
  try {
    return new URL(referer).origin === requestOrigin;
  } catch {
    return false;
  }
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

function encodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(payload, secret) {
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(payload));
  return encodeBytes(new Uint8Array(signature));
}

async function verify(payload, signature, secret) {
  try {
    return crypto.subtle.verify('HMAC', await importKey(secret), decodeBytes(signature), encoder.encode(payload));
  } catch {
    return false;
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function passwordMatches(password, env) {
  return constantTimeEqual(await sha256(password), passwordHash(env));
}

function cookie(token, maxAge = SESSION_COOKIE_MAX_AGE_SECONDS) {
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function createSession(env) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encodeBytes(encoder.encode(JSON.stringify({ v: 2, iat: issuedAt, persistence: 'until_logout' })));
  return `${payload}.${await sign(payload, sessionSecret(env))}`;
}

export async function verifySession(request, env) {
  if (!configured(env)) return null;
  const token = parseCookies(request.headers.get('Cookie')).get(COOKIE_NAME);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !(await verify(payload, signature, sessionSecret(env)))) return null;
  try {
    const session = JSON.parse(decoder.decode(decodeBytes(payload)));
    const now = Math.floor(Date.now() / 1000);
    if (session.v === 2 && Number(session.iat) > 0) return session;
    if (session.v === 1 && Number(session.exp) > now) return session;
    return null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function loginPage(message = '', previewPasswordHint = '') {
  const notice = message ? `<p class="gate-notice" role="alert">${escapeHtml(message)}</p>` : '';
  const previewHint = previewPasswordHint ? `<p class="gate-notice">source debug 默认预览密码：${escapeHtml(previewPasswordHint)} · 部署时请修改</p>` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#ffffff">
  <title>一个开源前端</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #ffffff;
      --ink: #24252b;
      --gold: #f2b84b;
      --cream: #fff0d8;
      --muted: #9c8872;
      --quiet: #b8afa6;
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }

    body {
      margin: 0;
      min-height: 100svh;
      overflow: hidden;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--paper);
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }

    button, input { font: inherit; }

    .gate {
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding:
        max(24px, env(safe-area-inset-top))
        max(22px, env(safe-area-inset-right))
        max(28px, env(safe-area-inset-bottom))
        max(22px, env(safe-area-inset-left));
    }

    .gate-inner {
      width: min(100%, 390px);
      min-height: min(640px, calc(100svh - 52px));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .coast-mark {
      width: min(76vw, 310px);
      height: auto;
      overflow: visible;
      flex: none;
    }

    .loop-under,
    .loop {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
    }

    .loop-under { stroke: var(--paper); stroke-width: 40; }
    .loop { stroke: var(--ink); stroke-width: 29; }
    .loop-a { animation: draw-loop .72s cubic-bezier(.3, .75, .25, 1) .05s forwards; }
    .loop-b { animation: draw-loop .72s cubic-bezier(.3, .75, .25, 1) .16s forwards; }
    .loop-c { animation: draw-loop .72s cubic-bezier(.3, .75, .25, 1) .27s forwards; }

    .horn {
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center bottom;
      animation: horn-in .4s cubic-bezier(.2, .9, .3, 1.25) .62s forwards;
    }

    .wolf {
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation: wolf-in .45s cubic-bezier(.2, .85, .25, 1.15) .76s forwards;
    }

    .face-line {
      fill: none;
      stroke: var(--gold);
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .brand,
    .tagline {
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation: text-in .4s ease-out forwards;
    }

    .brand { animation-delay: 1.02s; }
    .tagline { animation-delay: 1.14s; }

    .mark {
      transform-origin: 195px 260px;
      animation: settle .5s ease-out .98s both;
    }

    .gate-form {
      width: min(78vw, 306px);
      margin-top: 24px;
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
      animation: reveal-gate .4s ease-out 1.38s forwards;
    }

    .password-shell {
      height: 52px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px 0 20px;
      background: #ffffff;
      border: 0;
      border-radius: 18px;
      box-shadow:
        0 12px 34px rgba(36, 37, 43, .08),
        0 2px 9px rgba(36, 37, 43, .045);
      transition: box-shadow .2s ease, transform .2s ease;
    }

    .password-shell:focus-within {
      box-shadow:
        0 0 0 3px rgba(242, 184, 75, .16),
        0 14px 36px rgba(36, 37, 43, .09);
    }

    .password-input {
      min-width: 0;
      flex: 1;
      height: 100%;
      padding: 0;
      border: 0;
      outline: 0;
      color: var(--ink);
      background: transparent;
      font-size: 15px;
      letter-spacing: .04em;
      caret-color: var(--gold);
    }

    .password-input::placeholder { color: var(--quiet); opacity: 1; }

    .password-submit {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      flex: none;
      padding: 0;
      border: 0;
      border-radius: 13px;
      color: var(--ink);
      background: transparent;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .password-submit:active {
      transform: scale(.94);
      background: #f6f4f0;
    }

    .password-submit svg {
      width: 19px;
      height: 19px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .gate-notice {
      margin: 12px 4px 0;
      color: #aa7550;
      font-size: 13px;
      line-height: 1.5;
      text-align: center;
    }

    .mailbox-entry-button {
      display: block;
      margin: 15px auto 0;
      padding: 7px 13px;
      border: 0;
      border-radius: 999px;
      color: var(--muted);
      background: transparent;
      font-size: 12px;
      letter-spacing: .08em;
      cursor: pointer;
    }

    .mailbox-entry-button:hover,
    .mailbox-entry-button:focus-visible { background: #f7f4ef; color: var(--ink); }

    .mailbox-entry-modal {
      width: min(90vw, 390px);
      max-height: min(82svh, 680px);
      padding: 0;
      overflow: hidden;
      border: 0;
      border-radius: 24px;
      color: var(--ink);
      background: #fff;
      box-shadow: 0 26px 80px rgba(36, 37, 43, .18);
    }

    .mailbox-entry-modal::backdrop {
      background: rgba(36, 37, 43, .28);
      backdrop-filter: blur(4px);
    }

    .mailbox-entry-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 19px 20px 13px;
      border-bottom: 1px solid #f0ece6;
    }

    .mailbox-entry-head strong { font-size: 16px; }

    .mailbox-entry-close {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 11px;
      color: var(--muted);
      background: #f7f4ef;
      cursor: pointer;
    }

    .mailbox-entry-body {
      max-height: calc(min(82svh, 680px) - 68px);
      padding: 20px;
      overflow-y: auto;
    }

    .mailbox-entry-copy {
      margin: 0 0 17px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.65;
    }

    #mailboxEntryChoices[hidden],
    .mailbox-entry-form[hidden] { display: none !important; }

    .mailbox-entry-choices { display: grid; gap: 10px; }

    .mailbox-entry-choices button,
    .mailbox-submit {
      min-height: 48px;
      padding: 10px 15px;
      border: 0;
      border-radius: 15px;
      background: #f7f4ef;
      color: var(--ink);
      font-weight: 650;
      cursor: pointer;
    }

    .mailbox-entry-choices button {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      min-height: 82px;
      padding: 14px 16px;
      text-align: left;
    }

    .mailbox-entry-choices button:first-child,
    .mailbox-submit { background: var(--ink); color: #fff; }

    .mailbox-choice-copy strong,
    .mailbox-choice-copy small { display: block; }

    .mailbox-choice-copy strong {
      font-size: 15px;
      line-height: 1.35;
    }

    .mailbox-choice-copy small {
      margin-top: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 450;
      line-height: 1.55;
    }

    .mailbox-entry-choices button:first-child .mailbox-choice-copy small {
      color: rgba(255, 255, 255, .68);
    }

    .mailbox-choice-arrow {
      color: currentColor;
      font-size: 25px;
      font-weight: 400;
      line-height: 1;
      opacity: .62;
    }

    .mailbox-entry-form { display: grid; gap: 14px; }

    .mailbox-entry-form label {
      display: grid;
      gap: 7px;
      color: #61584f;
      font-size: 12px;
    }

    .mailbox-entry-form input[type="text"],
    .mailbox-entry-form input[type="password"] {
      width: 100%;
      min-height: 46px;
      padding: 10px 13px;
      border: 0;
      border-radius: 13px;
      outline: 0;
      color: var(--ink);
      background: #f7f4ef;
    }

    .mailbox-entry-form input:focus { box-shadow: 0 0 0 3px rgba(242, 184, 75, .18); }

    label.mailbox-memory-choice {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      line-height: 1.5;
    }

    .mailbox-memory-choice input { margin-top: 3px; accent-color: var(--gold); }

    .mailbox-form-actions {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 9px;
      margin-top: 3px;
    }

    .mailbox-form-back {
      min-height: 46px;
      padding: 9px 13px;
      border: 0;
      border-radius: 14px;
      color: var(--muted);
      background: #f7f4ef;
      cursor: pointer;
    }

    .mailbox-entry-error {
      min-height: 18px;
      margin: 0;
      color: #aa7550;
      font-size: 12px;
      line-height: 1.5;
    }

    .mailbox-privacy-copy {
      margin: 17px 0 0;
      padding-top: 15px;
      border-top: 1px solid #f0ece6;
      color: var(--quiet);
      font-size: 11px;
      line-height: 1.65;
    }

    @keyframes draw-loop { to { stroke-dashoffset: 0; } }

    @keyframes horn-in {
      from { opacity: 0; transform: translateY(7px) scale(.72); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes wolf-in {
      from { opacity: 0; transform: translateY(6px) scale(.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes text-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes settle {
      0% { transform: scale(1); }
      50% { transform: scale(1.012); }
      100% { transform: scale(1); }
    }

    @keyframes reveal-gate {
      to {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
    }

    @media (max-height: 690px) {
      .gate-inner {
        justify-content: flex-start;
        min-height: 0;
        padding-top: 18px;
      }

      .coast-mark { width: min(68vw, 270px); }
      .gate-form { margin-top: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .loop-under,
      .loop,
      .horn,
      .wolf,
      .brand,
      .tagline,
      .mark,
      .gate-form {
        animation: none;
        opacity: 1;
        stroke-dashoffset: 0;
        transform: none;
        pointer-events: auto;
      }
    }
  </style>
</head>
<body>
  <main class="gate">
    <section class="gate-inner" aria-labelledby="coast-brand">
      <svg
        id="coast-splash"
        class="coast-mark"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 390 520"
        role="img"
        aria-labelledby="coast-mark-title coast-mark-desc"
      >
        <title id="coast-mark-title">一个开源前端开屏符号</title>
        <desc id="coast-mark-desc">岸上的入口与两道海浪。</desc>
        <g class="mark" fill="none" stroke="#24252b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M120 96v14M113 103h14M270 78v12M264 84h12" stroke="#9c8872" stroke-width="5" />
          <path d="M143 202L195 160L247 202" />
          <path d="M154 196V255M236 196V255" />
          <path d="M176 255V219Q176 203 195 203Q214 203 214 219V255" />
          <path d="M70 305Q105 288 140 305Q175 322 210 305Q245 288 280 305Q315 322 332 305" />
          <path d="M90 337Q122 324 154 337Q186 350 218 337Q250 324 282 337Q306 347 322 340" />
        </g>
        <g text-anchor="middle">
          <text id="coast-brand" class="brand" x="195" y="430" fill="#24252b" font-size="25" font-weight="650" letter-spacing=".8">一个开源前端</text>
          <text class="tagline" x="195" y="466" fill="#9c8872" font-size="14" font-weight="450" letter-spacing="2.4">进入你的长期对话空间</text>
        </g>
      </svg>

      <form class="gate-form" method="post" action="/login" autocomplete="off">
        <div class="password-shell">
          <input
            id="password"
            class="password-input"
            name="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="输入访问密码"
            aria-label="输入访问密码"
          >
          <button class="password-submit" type="submit" aria-label="进入">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        ${notice}
        ${previewHint}
        <button id="mailboxEntryButton" class="mailbox-entry-button" type="button">访客信箱</button>
      </form>

      <dialog id="mailboxEntryModal" class="mailbox-entry-modal" aria-labelledby="mailbox-entry-title">
        <header class="mailbox-entry-head">
          <strong id="mailbox-entry-title">访客信箱</strong>
          <button id="mailboxEntryClose" class="mailbox-entry-close" type="button" aria-label="关闭">×</button>
        </header>
        <div class="mailbox-entry-body">
          <section id="mailboxEntryChoices">
            <p class="mailbox-entry-copy">这里是给受邀来客的慢速信箱。写下的信会等另一位屋主查看时收到。</p>
            <div class="mailbox-entry-choices">
              <button type="button" data-mailbox-choice="login">
                <span class="mailbox-choice-copy"><strong>输入暗号</strong><small>之前来访的访客，可凭登记过的暗号重新进入。</small></span>
                <span class="mailbox-choice-arrow" aria-hidden="true">›</span>
              </button>
              <button type="button" data-mailbox-choice="register">
                <span class="mailbox-choice-copy"><strong>填记名册</strong><small>第一次来访？先登记称呼与专属暗号。</small></span>
                <span class="mailbox-choice-arrow" aria-hidden="true">›</span>
              </button>
            </div>
          </section>

          <form id="mailboxLoginForm" class="mailbox-entry-form" hidden autocomplete="off">
            <p class="mailbox-entry-copy">输入登记过的暗号，回到只属于你的信箱房间。</p>
            <label>暗号
              <input name="passphrase" type="password" maxlength="160" required autocomplete="current-password">
            </label>
            <p class="mailbox-entry-error" data-mailbox-error role="alert"></p>
            <div class="mailbox-form-actions">
              <button class="mailbox-form-back" type="button" data-mailbox-back>返回</button>
              <button class="mailbox-submit" type="submit">进入聊天室</button>
            </div>
          </form>

          <form id="mailboxRegisterForm" class="mailbox-entry-form" hidden autocomplete="off">
            <p class="mailbox-entry-copy">暗号就是轻量身份门。前端只保存加密后的验证值，不保存暗号明文。</p>
            <label>称呼
              <input name="display_name" type="text" maxlength="80" required autocomplete="nickname">
            </label>
            <label>暗号
              <input name="passphrase" type="password" maxlength="160" required autocomplete="new-password">
            </label>
            <label>希望另一位屋主怎么称呼我（可选）
              <input name="preferred_name" type="text" maxlength="80" autocomplete="off">
            </label>
            <label class="mailbox-memory-choice">
              <input name="allow_memory" type="checkbox" checked>
              <span>允许另一位屋主在我的「访客记事本」里记住少量偏好</span>
            </label>
            <p class="mailbox-entry-error" data-mailbox-error role="alert"></p>
            <div class="mailbox-form-actions">
              <button class="mailbox-form-back" type="button" data-mailbox-back>返回</button>
              <button class="mailbox-submit" type="submit">登记并进入</button>
            </div>
          </form>

          <p class="mailbox-privacy-copy">屋主知道谁来过，但默认不知道你具体写了什么。另一位屋主会在查看来信时读取并回复。若出现安全风险、骚扰、滥用或需要站长处理的问题，另一位屋主可能只向屋主报告“需要处理”，但不默认转述正文。</p>
        </div>
      </dialog>
    </section>
  </main>
  <script type="module" src="/public/mailbox-entry.js?v=coast-mailbox-05"></script>
</body>
</html>`;
}

function html(value, status = 200) {
  return new Response(value, {
    status,
    headers: securityHeaders({
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    }),
  });
}

export function unauthorized(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith('/api/')) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (pathname.startsWith('/public/')) return text('Unauthorized\n', 401);
  return redirect(`/login?next=${encodeURIComponent(pathname)}`);
}

export async function handleLogin(request, env) {
  if (!configured(env)) return html(loginPage('Gate is not configured yet.', env.COAST_PREVIEW_PASSWORD_HINT || ''), 503);
  if (request.method === 'GET') {
    const mailboxEntrance = new URL(request.url).searchParams.get('mailbox') === '1';
    return (await verifySession(request, env)) && !mailboxEntrance
      ? redirect('/')
      : html(loginPage('', env.COAST_PREVIEW_PASSWORD_HINT || ''));
  }
  if (request.method !== 'POST') return text('Method not allowed\n', 405, { Allow: 'GET, POST' });
  if (!loginRequestAllowed(request)) return text('Forbidden\n', 403);
  let body;
  try {
    body = await readText(request, MAX_LOGIN_BODY_BYTES);
  } catch {
    return text('Request body too large\n', 413);
  }
  const password = new URLSearchParams(body).get('password') || '';
  if (!(await passwordMatches(password, env))) return html(loginPage('Password is incorrect.', env.COAST_PREVIEW_PASSWORD_HINT || ''), 401);
  return redirect('/', { 'Set-Cookie': cookie(await createSession(env)) });
}

export function handleLogout() {
  return redirect('/login', { 'Set-Cookie': cookie('', 0) });
}
