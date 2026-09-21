import { chooseImage, downloadFile, escapeAttribute, escapeHtml, q, timestampLabel } from '../core/dom.js';
import { API, requestJson } from '../core/api.js';
import { shortModelName } from '../core/model-format.js';

const LOADED_AT = new Date().toISOString();

function row(title, subtitle, action, extra = '') {
  return `<button class="feature-row" type="button" data-action="${escapeAttribute(action)}" ${extra}><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span></button>`;
}

function line(title, subtitle) {
  return `<div class="feature-row static"><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span></div>`;
}

function group(title, body) {
  return `<section class="feature-group"><h2>${escapeHtml(title)}</h2><div class="feature-card">${body}</div></section>`;
}

function currentAppVersion() {
  const script = [...document.scripts].find((item) => /\/public\/app\.js(?:\?|$)/.test(item.src || ''));
  if (!script?.src) return 'unknown';
  try {
    return new URL(script.src, location.href).searchParams.get('v') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function localArchiveState(storage, chat) {
  const local = storage.read();
  return {
    preferences: local.preferences || {},
    run_control: local.runControl || {},
    rooms: local.rooms || {},
    daily_cache: local.daily || {},
    letters: local.letters || {},
    current_conversation_id: chat.getCurrentConversationId() || null,
    current_app_version: currentAppVersion(),
    exported_from: 'pwa',
  };
}

function sizeLabel(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function createSettings({ storage, shell, chat, router, toast }) {
  const preferences = () => storage.read().preferences;

  router.register('wolf', () => {
    const currentModel = chat.getProfile().current_chat_model;
    return {
      title: '屋主设置 / 屋主设置',
      subtitle: '人类屋主设置显示资料 · 外观 · 聊天与运行设置',
      className: 'settings-panel',
      body: group('人类屋主设置',
        row('个人资料', '昵称、聊天署名与显示资料', 'settings:profile')
        + row('外观', '主题、用户气泡与重点色', 'settings:appearance')
        + row('账户', '当前登录状态与主动退出', 'settings:account')
        + row('聊天记录', '完整前端包 / 当前窗口导出 / 导入', 'settings:chat-records')
        + row('模型箱', `当前：${shortModelName(currentModel || '未选择')}`, 'models:open')
        + row('基本设置', '回答长度、流式输出、记忆召回与世界书', 'tools:basic-settings')
        + row('版本与更新', 'PWA / Native / GitHub Release / SHA-256', 'devhands:update')
        + row('关于与诊断', '版本、缓存、Service Worker 与当前窗口', 'settings:diagnostics')),
    };
  });

  router.register('desk', () => ({
    title: '模型工作台',
    subtitle: '模型伙伴的工作台',
    className: 'settings-panel',
    body: group('前端施工台',
      row('开发手 / 施工台', 'GitHub · CI / APK · Notion · 屋主设置更新', 'devhands:open')
      + row('工具调用记录', '普通前端工具调用 · 房间 · 脱敏摘要', 'toolroom:open')),
  }));

  router.register('settings-profile', () => ({
    title: '个人资料',
    subtitle: '屋主在前端的显示资料',
    className: 'settings-form',
    body: `<p class="feature-note">这里保存屋主在前端的显示资料。这些显示资料不会自动进入模型伙伴的记忆或系统提示词。真正影响模型伙伴理解你的长期内容，请写入自定义指令或记忆库。</p>
      <div class="form-stack">
        <label>昵称<input id="ownerName" value="${escapeAttribute(preferences().ownerName)}" maxlength="80"></label>
        <label>聊天署名 / 导出时显示名<input id="ownerSignature" value="${escapeAttribute(preferences().ownerSignature)}" maxlength="80"></label>
        <button class="feature-row" type="button" data-action="settings:bubble"><span><strong>用户气泡颜色</strong><small>复用外观里的同一项设置</small></span></button>
        <p class="feature-note">头像在碳硅圈资料中设置。本页不另建第二套头像存储。</p>
        <button class="primary-wide" type="button" data-action="settings:save-profile">保存个人资料</button>
      </div>`,
  }));

  router.register('settings-account', async () => {
    const data = await requestJson(API.session);
    const session = data.session || {};
    const account = data.account || {};
    return {
      title: '账户',
      subtitle: '前端登录态',
      className: 'settings-panel',
      body: group('当前账户',
        line('登录状态', data.authenticated ? '已登录' : '未登录')
        + line('账号', account.display_name || account.type || '前端屋主')
        + line('登录保持', session.persistence === 'until_logout' ? '持续保持，直到主动退出' : (session.expires_at ? `旧会话 · 到期 ${session.expires_at}` : '当前会话'))
        + line('本次登录', session.issued_at || '未记录'))
        + group('退出', '<button class="danger-row" type="button" data-action="settings:logout"><strong>退出账号</strong><small>只在确认后清除当前前端登录态，并回到登录前页面。</small></button>'),
    };
  });

  router.register('settings-appearance', () => ({
    title: '外观',
    subtitle: '前端本机显示',
    className: 'settings-panel',
    body: group('外观',
      row('主题', '浅色 / 深色 / 黑金', 'settings:theme')
      + row('用户气泡颜色', '屋主消息气泡', 'settings:bubble')
      + row('重点色', '橙色 / 金色 / 蓝色 / 粉色', 'settings:accent')),
  }));

  router.register('settings-chat-records', () => ({
    title: '聊天记录',
    subtitle: '完整前端与当前窗口 · 本机导入导出',
    className: 'settings-panel',
    body: group('完整前端',
      row('导出完整前端包', '前端完整数据 · 朋友信箱只含隐私摘要，不含访客正文 / 暗号材料', 'settings:export-full-archive')
      + row('导出 V1 防丢快照', '轻量 JSON · 附件只存索引 · 朋友信箱只含隐私摘要', 'settings:export-v1-snapshot')
      + row('导出全局 HTML', '与 V1 JSON 同源 · 朋友信箱仅隐私摘要 · 不含访客正文', 'settings:export-html'))
      + group('当前窗口',
        row('导出当前窗口 JSON', '只保留当前消息与显示资料 metadata', 'settings:export-json')
        + row('导入 JSON', '恢复到当前窗口', 'settings:import-json')),
  }));

  router.register('settings-theme', () => ({
    title: '主题',
    subtitle: '选择本地主题',
    body: group('主题', row('浅色', 'Light', 'settings:set-theme', 'data-value="light"') + row('深色', 'Dark', 'settings:set-theme', 'data-value="dark"') + row('黑金', 'Gold', 'settings:set-theme', 'data-value="gold"')),
  }));

  router.register('settings-bubble', () => ({
    title: '用户气泡颜色',
    subtitle: '屋主消息气泡',
    body: group('气泡', row('默认', '跟随主题', 'settings:set-bubble', 'data-value=""') + row('冷蓝灰', '#eaf0f7', 'settings:set-bubble', 'data-value="#eaf0f7"') + row('浅粉灰', '#f5e8ee', 'settings:set-bubble', 'data-value="#f5e8ee"') + row('淡金灰', '#f1ead8', 'settings:set-bubble', 'data-value="#f1ead8"')),
  }));

  router.register('settings-accent', () => ({
    title: '重点色',
    subtitle: '按钮与强调色',
    body: group('重点色', row('橙色', '#ff6a21', 'settings:set-accent', 'data-value="#ff6a21"') + row('金色', '#f28b2e', 'settings:set-accent', 'data-value="#f28b2e"') + row('蓝色', '#3b82f6', 'settings:set-accent', 'data-value="#3b82f6"') + row('粉色', '#ec4899', 'settings:set-accent', 'data-value="#ec4899"')),
  }));

  router.register('settings-diagnostics', async () => {
    const conversation = chat.getCurrentConversation();
    const appVersion = currentAppVersion();
    const serviceWorkerSupported = 'serviceWorker' in navigator;
    const registration = serviceWorkerSupported && typeof navigator.serviceWorker.getRegistration === 'function'
      ? await navigator.serviceWorker.getRegistration('/').catch(() => null)
      : null;
    const controller = serviceWorkerSupported ? navigator.serviceWorker.controller : null;
    return {
      title: '关于与诊断',
      subtitle: '真机缓存与当前聊天状态 · 不发额外网络请求',
      body: group('版本与缓存',
        line('当前 app 版本', appVersion)
        + line('当前缓存版本', appVersion === 'unknown' ? 'unknown' : `elementera-${appVersion}`)
        + line('Service Worker 注册状态', !serviceWorkerSupported ? 'unsupported' : registration ? 'registered' : 'not registered')
        + line('Service Worker controller', controller ? controller.state || 'controlled' : 'not controlled'))
        + group('当前聊天',
          line('当前窗口 id', chat.getCurrentConversationId() || '未载入')
          + line('当前 room_type', conversation?.room_type || '未载入')
          + line('当前模型', shortModelName(chat.getProfile().current_chat_model || '未选择'))
          + line('最近载入时间', LOADED_AT)
          + line('本地状态 key', 'elementera.local.v1')),
    };
  });

  async function exportFullArchive() {
    toast('正在把完整前端收进一个包里…附件多时会慢一点。', 3200);
    const data = await requestJson(API.fullArchive);
    const archive = {
      ...(data.archive || {}),
      local_device: localArchiveState(storage, chat),
    };
    archive.included_modules = [
      ...(Array.isArray(archive.included_modules) ? archive.included_modules : []),
      'local_device_settings',
      'local_letters',
    ].filter((item, index, list) => list.indexOf(item) === index);
    const body = JSON.stringify(archive, null, 2);
    const bytes = new Blob([body], { type: 'application/json' }).size;
    downloadFile(body, `elementera-coast-full-${timestampLabel()}.coastpack.json`, 'application/json');
    toast(`完整前端包已生成 · ${sizeLabel(bytes)} · 模型后端返回原文 ${Number(archive.model_echoes?.length || 0)} 条 · 附件原件 ${Number(archive.attachments?.payloads?.length || 0)} 个`, 5200);
  }

  async function exportV1Snapshot() {
    toast('正在把 V1 的家收进防丢快照…', 2400);
    const data = await requestJson(API.v1Snapshot);
    const snapshot = {
      ...(data.snapshot || {}),
      local_device: localArchiveState(storage, chat),
    };
    snapshot.included_modules = [
      ...(Array.isArray(snapshot.included_modules) ? snapshot.included_modules : []),
      'local_device_settings',
      'local_letters',
    ].filter((item, index, list) => list.indexOf(item) === index);
    const body = JSON.stringify(snapshot, null, 2);
    const bytes = new Blob([body], { type: 'application/json' }).size;
    downloadFile(body, `elementera-coast-v1-snapshot-${timestampLabel()}.json`, 'application/json');
    toast(`V1 防丢快照已生成 · ${sizeLabel(bytes)} · 附件 ${Number(snapshot.attachments?.count || 0)} 个索引`, 4200);
  }

  function exportJson() {
    const display = {
      nickname: preferences().ownerName || '屋主',
      signature: preferences().ownerSignature || preferences().ownerName || '屋主',
    };
    const data = {
      format: 'elementera-chat-export',
      version: '4',
      exported_at: new Date().toISOString(),
      display_profile: display,
      messages: chat.getActiveMessages(),
    };
    downloadFile(JSON.stringify(data, null, 2), `elementera-chat-export-${timestampLabel()}.json`, 'application/json');
  }

  function snapshotChatHtml(snapshot, signature) {
    const records = Array.isArray(snapshot?.chat?.conversations) ? snapshot.chat.conversations : [];
    return records.map(({ conversation = {}, history = {} }) => {
      const messages = [];
      for (const turn of Array.isArray(history?.turns) ? history.turns : []) {
        const users = turn?.user?.variants || [];
        const userIndex = Math.min(Math.max(0, Number(turn?.user?.active) || 0), Math.max(0, users.length - 1));
        const user = users[userIndex];
        if (user?.content) messages.push({ role: 'user', content: user.content, created_at: user.created_at });
        const assistants = turn?.assistant?.variantsByUserVariant?.[String(userIndex)] || [];
        const assistantIndex = Math.min(Math.max(0, Number(turn?.assistant?.activeByUserVariant?.[String(userIndex)]) || 0), Math.max(0, assistants.length - 1));
        const assistant = assistants[assistantIndex];
        if (assistant?.content) messages.push({ role: 'assistant', content: assistant.content, created_at: assistant.created_at });
      }
      const rows = messages.map((message) => `<article class="m ${message.role}"><b>${escapeHtml(message.role === 'user' ? signature : '模型伙伴')}</b><div>${escapeHtml(message.content).replace(/\\n/g, '<br>')}</div></article>`).join('');
      return `<section class="window"><h2>${escapeHtml(conversation.room_type || 'main')}｜${escapeHtml(conversation.title || conversation.id || '未命名窗口')}</h2><small>${escapeHtml(conversation.updated_at || '')}</small>${rows || '<p class="empty">没有可读消息。</p>'}</section>`;
    }).join('');
  }

  function snapshotDataSection(title, value) {
    return `<section class="data"><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre></section>`;
  }

  async function exportHtml() {
    toast('正在把完整前端整理成 HTML…', 2600);
    const signature = preferences().ownerSignature || preferences().ownerName || '屋主';
    const data = await requestJson(API.v1Snapshot);
    const snapshot = {
      ...(data.snapshot || {}),
      local_device: localArchiveState(storage, chat),
    };
    const chatHtml = snapshotChatHtml(snapshot, signature);
    const sections = [
      snapshotDataSection('整理当前对话的纸条', snapshot.thinking_soil),
      snapshotDataSection('记忆系统 / 全局摘录 / 自定义指令', snapshot.memory),
      snapshotDataSection('世界书', snapshot.worldbook),
      snapshotDataSection('访客信箱 / 来信（隐私摘要）', snapshot.mailbox),
      snapshotDataSection('日记与动态', snapshot.daily),
      snapshotDataSection('模型资料与回波摘要', { model_profile: snapshot.model_profile, model_echo_summaries: snapshot.model_echo_summaries }),
      snapshotDataSection('工具日志摘要', snapshot.tools),
      snapshotDataSection('附件索引与元数据', snapshot.attachments),
      snapshotDataSection('搜索摘要', snapshot.web_search),
      snapshotDataSection('版本与本机设置', { versions: snapshot.versions, local_device: snapshot.local_device }),
    ].join('');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elementera Coast Global Export</title><style>
      :root{color-scheme:light dark}body{font-family:system-ui,-apple-system,sans-serif;line-height:1.68;margin:0;background:#f7f5f1;color:#2d2926}.w{max-width:920px;margin:auto;padding:28px 16px 60px}h1{font-size:25px}h2{font-size:16px;margin:0 0 6px}.meta,small{color:#857d76}.window,.data{margin:18px 0;padding:18px;border-radius:18px;background:rgba(255,255,255,.72);box-shadow:0 8px 28px rgba(60,45,35,.05)}.m{margin:14px 0}.m b{display:block;font-size:12px;color:#8c837c}.m div{display:inline-block;max-width:90%;padding:10px 13px;border-radius:15px;background:#f0ece6}.m.user{text-align:right}.m.user div{background:#e8eef3}.m.user b{text-align:right}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:13px;border-radius:13px;background:rgba(80,70,60,.055);font:12px/1.6 ui-monospace,SFMono-Regular,monospace}.empty{color:#8c837c}@media(prefers-color-scheme:dark){body{background:#171615;color:#e8e1da}.window,.data{background:#211f1d}.m div{background:#2b2926}.m.user div{background:#26303a}pre{background:#191817}}
    </style></head><body><main class="w"><h1>Elementera Coast · 全局 HTML</h1><p class="meta">导出时间：${escapeHtml(snapshot.exported_at || new Date().toISOString())} · 数据范围与 V1 JSON 快照同源；附件二进制本体不写入 HTML。</p><h1>聊天窗口</h1>${chatHtml}${sections}</main></body></html>`;
    const bytes = new Blob([html], { type: 'text/html' }).size;
    downloadFile(html, `elementera-coast-global-${timestampLabel()}.html`, 'text/html');
    toast(`全局 HTML 已生成 · ${sizeLabel(bytes)} · 窗口 ${Number(snapshot.chat?.conversations?.length || 0)} 个`, 4200);
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const raw = JSON.parse(await file.text());
        const messages = Array.isArray(raw) ? raw : raw.messages;
        if (!Array.isArray(messages)) throw new Error('messages not found');
        await chat.importFlatMessages(messages);
        await router.close();
        toast('聊天记录已导入当前窗口');
      } catch (error) {
        toast(`导入失败：${error.message}`);
      }
    }, { once: true });
    input.click();
  }

  async function handleAction(name, target) {
    const routes = {
      wolf: 'wolf',
      desk: 'desk',
      profile: 'settings-profile',
      appearance: 'settings-appearance',
      account: 'settings-account',
      'chat-records': 'settings-chat-records',
      theme: 'settings-theme',
      bubble: 'settings-bubble',
      accent: 'settings-accent',
      diagnostics: 'settings-diagnostics',
    };
    if (routes[name]) return router.open(routes[name]);
    if (name === 'avatar') {
      try {
        const image = await chooseImage();
        if (image) await chat.updateProfile({ assistant_avatar_dataurl: image });
      } catch (error) {
        toast(`头像保存失败：${error.message}`);
      }
      return;
    }
    if (name === 'set-theme') {
      shell.setTheme(target.dataset.value);
      return router.refresh();
    }
    if (name === 'set-bubble') {
      storage.update((state) => { state.preferences.userBubble = target.dataset.value || ''; });
      shell.applyPreferences();
      return router.refresh();
    }
    if (name === 'set-accent') {
      storage.update((state) => { state.preferences.accent = target.dataset.value || ''; });
      shell.applyPreferences();
      return router.refresh();
    }
    if (name === 'save-profile') {
      storage.update((state) => {
        state.preferences.ownerName = q('#ownerName')?.value || '屋主';
        state.preferences.ownerSignature = q('#ownerSignature')?.value || state.preferences.ownerName || '屋主';
      });
      toast('个人资料已保存');
      return;
    }
    if (name === 'logout') {
      globalThis.location.assign('/logout');
      return;
    }
    if (name === 'export-full-archive') {
      return exportFullArchive().catch((error) => toast(`完整前端包导出失败：${error.message}`, 5200));
    }
    if (name === 'export-v1-snapshot') {
      return exportV1Snapshot().catch((error) => toast(`V1 快照导出失败：${error.message}`, 4200));
    }
    if (name === 'export-json') return exportJson();
    if (name === 'export-html') return exportHtml();
    if (name === 'import-json') return importJson();
  }

  return Object.freeze({ handleAction });
}
