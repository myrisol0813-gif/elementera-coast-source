import { clearMailboxSessionCookie, verifyMailboxSession } from './mailbox-auth.js';
import { redirect, securityHeaders, text } from './http.js';
import { currentMailboxVisitor } from './mailbox-service.js';

const PAGE = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff">
  <title>访客信箱 · Elementera Coast</title>
  <link rel="stylesheet" href="/public/styles/tokens.css?v=coast-app-85">
  <link rel="stylesheet" href="/public/styles/shell.css?v=coast-app-85">
  <link rel="stylesheet" href="/public/styles/chat.css?v=coast-app-85">
  <link rel="stylesheet" href="/public/styles/features.css?v=coast-app-85">
  <link rel="stylesheet" href="/public/styles/mailbox.css?v=coast-mailbox-05">
</head>
<body class="mailbox-body">
  <div id="mailboxApp" class="app-shell mailbox-shell">
    <main class="main-panel">
      <header class="topbar mailbox-topbar">
        <a class="icon-button mailbox-back" href="/login?mailbox=1" aria-label="返回访客信箱入口" data-icon="back"></a>
        <div class="room-heading">
          <div class="mailbox-title-row">
            <strong>访客信箱</strong>
            <span id="mailboxConversationMenuWrap" class="mailbox-conversation-menu-wrap">
              <button id="mailboxConversationMenu" class="mailbox-conversation-menu-button" type="button" aria-label="访客房间操作" aria-expanded="false">›</button>
              <span id="mailboxConversationBubble" class="mailbox-conversation-bubble" hidden>
                <button class="danger" type="button" data-mailbox-action="delete-account">删除整个对话</button>
              </span>
            </span>
          </div>
          <small id="mailboxVisitorLabel">慢速回信房间</small>
        </div>
        <div class="topbar-actions mailbox-top-actions">
          <button type="button" data-panel="notebook">访客记事本</button>
        </div>
      </header>

      <section class="window-surface mailbox-window">
        <section id="mailboxMessageScroller" class="message-scroller" aria-label="访客信箱消息">
          <div id="mailboxMessages" class="messages mailbox-messages">
            <div class="empty-state">正在打开你的海岸房间…</div>
          </div>
        </section>

        <section id="mailboxStatusBar" class="mailbox-status-bar" aria-live="polite">
          <div>
            <strong id="mailboxStatusText">现在是慢速回信模式，不是实时聊天。</strong>
            <small id="mailboxStatusMeta">屋主知道谁来过，但默认不知道你具体写了什么。</small>
          </div>
          <button id="mailboxRefreshButton" type="button">查看回信</button>
        </section>

        <form id="mailboxComposer" class="composer composer--room mailbox-composer" autocomplete="off">
          <div class="input-pill">
            <textarea id="mailboxPromptInput" rows="1" maxlength="40000" placeholder="把一封信投进海岸" aria-label="写给另一位屋主的来信"></textarea>
          </div>
          <button id="mailboxSendButton" class="composer-primary" type="submit" data-icon="send" aria-label="投入信箱"></button>
        </form>
      </section>
    </main>

    <dialog id="mailboxPanel" class="mailbox-panel">
      <header>
        <div><strong id="mailboxPanelTitle"></strong><small id="mailboxPanelSubtitle"></small></div>
        <button id="mailboxPanelClose" type="button" aria-label="关闭" data-icon="close"></button>
      </header>
      <div id="mailboxPanelBody" class="mailbox-panel-body"></div>
    </dialog>

    <div id="mailboxToast" class="toast" role="status" aria-live="polite" hidden></div>
  </div>
  <script type="module" src="/public/mailbox.js?v=coast-mailbox-05"></script>
</body>
</html>`;

function html(request) {
  return new Response(request.method === 'HEAD' ? null : PAGE, {
    status: 200,
    headers: securityHeaders({
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    }),
  });
}

export async function handleMailboxPage(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return text('Method not allowed\n', 405, { Allow: 'GET, HEAD' });
  if (!env?.COAST_CHAT_DB?.prepare) return text('Mailbox storage is not configured.\n', 503);
  const session = await verifyMailboxSession(request, env);
  if (!session) return redirect('/login?mailbox=1');
  try {
    await currentMailboxVisitor(env.COAST_CHAT_DB, session.visitor_id);
    return html(request);
  } catch {
    return redirect('/login?mailbox=1', { 'Set-Cookie': clearMailboxSessionCookie() });
  }
}
