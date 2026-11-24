import { chooseImage, downloadFile, escapeAttribute, escapeHtml, q, timestampLabel } from '../core/dom.js';
import { API, requestJson } from '../core/api.js';
import { shortModelName } from '../core/model-format.js';
import { createTransferSettings } from './settings-transfer.js';
import { buildOfflineArchive } from './offline-archive.js';

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

// A generated archive is not necessarily a complete recoverable backup.
// Keep missing payloads and incomplete indexes visible before migration.
export function auditFullArchiveCompleteness(archive) {
  const warnings = [];
  if (archive?.format !== 'elementera-coast-full-archive' || archive?.version !== 1) {
    warnings.push('文件格式或版本不符合完整海岸包约定');
  }
  if (!Array.isArray(archive?.chat?.conversations)) {
    warnings.push('缺少完整聊天窗口目录');
  }
  if (!archive?.coast_vault ||
      archive.coast_vault.basic_media?.complete !== true ||
      archive.coast_vault.treasures?.complete !== true) {
    warnings.push('基本文件库或拾潮索引缺失或存在未导出的分页');
  }
  const attachmentCount = Number(archive?.attachments?.count) || 0;
  const attachments = archive?.attachments?.payloads;
  if (attachmentCount > 0 && !Array.isArray(attachments)) {
    warnings.push('附件原件清单缺失');
  } else if (Array.isArray(attachments)) {
    const unavailable = attachments.filter(item => item?.unavailable === true).length;
    const omitted = Math.max(0, attachmentCount - attachments.length);
    if (unavailable || omitted) warnings.push('附件原件缺失 ' + (unavailable + omitted) + ' 项');
  }
  const voices = archive?.voice?.clips;
  const voicePayloads = archive?.voice?.payloads;
  if (Array.isArray(voices) && voices.length > 0 &&
      (!Array.isArray(voicePayloads) || voicePayloads.length < voices.length)) {
    warnings.push('已存语音原件数量与索引不一致');
  }
  return warnings;
}

export function createSettings({ storage, shell, chat, router, toast }) {
  const preferences = () => storage.read().preferences;
  const transfer = createTransferSettings({ router, toast, chat });

  router.register('wolf', () => {
    const currentModel = chat.getProfile().current_chat_model;
    return {
      title: '屋主设置 / 屋主设置',
      subtitle: '人类屋主设置显示资料 · 外观 · 聊天与运行设置',
      className: 'settings-panel',
      body: group('人类屋主设置',
        row('个人资料', '昵称、聊天署名与显示资料', 'settings:profile')
        + row('外观', '主题、文字气质、用户气泡与重点色', 'settings:appearance')
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
      row('主题', '七种可选外观 · 含雪粒信笺', 'settings:theme')
      + row('用户气泡颜色', '屋主消息气泡', 'settings:bubble')
      + row('重点色', '橙色 / 金色 / 蓝色 / 粉色', 'settings:accent')
      + row('文字气质', '经典宋体 / 柔和现代 / 手札', 'settings:font')),
  }));

  router.register('settings-chat-records', () => ({
    title: '聊天记录',
    subtitle: '完整前端与当前窗口 · 本机导入导出',
    className: 'settings-panel',
    body: group('海岸归档',
      row('导出完整海岸包', '当前可归档资料与原件 · 完整恢复尚未接通', 'settings:export-full-archive')
      + row('导出离线 HTML ZIP', '解压 index.html · 聊天变体、图片与语音原件', 'settings:export-html')
      + row('导入海岸包', '当前兼容 V1 迁移包；兼容导出也在此处', 'settings:transfer-open')),
  }));

  router.register('settings-theme', () => ({
    title: '主题',
    subtitle: '选择本地主题',
    body: group('主题', [
      ['light', '浅色', '简洁明亮'],
      ['dark', '深色', '静谧深灰'],
      ['gold', '黑金', '深夜的金色灯光'],
      ['paper', '雪粒信笺', '小信纸与柔软的蓝白纸边'],
      ['mist', '海雾蓝', '潮水与薄雾'],
      ['sage', '苔原绿', '安静的草地与苔藓'],
      ['blush', '薄暮粉', '夕照中的浅粉'],
    ].map(([value, title, subtitle]) => row(
      title, subtitle, 'settings:set-theme',
      `class="theme-choice" data-value="${value}" aria-pressed="${preferences().theme === value}"`,
    )).join('')),
  }));

  router.register('settings-font', () => ({
    title: '文字气质',
    subtitle: '聊天正文的字形与呼吸 · 仅本机',
    body: group('文字气质', [
      ['classic', '经典宋体', '宋体骨架 · 舒展清晰的长文'],
      ['soft', '柔和现代', '清透易读 · 干净的日常文字'],
      ['note', '手札', '霞鹜文楷 · 温暖的手写笔触'],
    ].map(([value, title, subtitle]) =>
      row(title, subtitle, 'settings:set-font', `class="reading-choice" data-value="${value}" aria-pressed="${preferences().fontMode === value}"`)
    ).join('')),
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
    const warnings = auditFullArchiveCompleteness(archive);
    if (warnings.length) {
      toast('海岸包已生成，但尚不能视为完整备份：' + warnings.join('；')
        + '。请保留原始数据、核对导出文件，不要直接迁移旧红心。', 11000);
    } else {
      toast(`完整前端包已生成 · ${sizeLabel(bytes)} · 模型后端返回原文 ${Number(archive.model_echoes?.length || 0)} 条 · 附件原件 ${Number(archive.attachments?.payloads?.length || 0)} 个。请核对已下载文件再迁移。`, 6500);
    }
  }

  async function exportHtml() {
    toast('正在整理离线海岸 ZIP…', 3000);
    const data = await requestJson(API.fullArchive);
    const archive = { ...(data.archive || {}), local_device: localArchiveState(storage, chat) };
    const result = buildOfflineArchive(archive, auditFullArchiveCompleteness(archive));
    downloadFile(result.blob, `elementera-coast-offline-${timestampLabel()}.zip`, 'application/zip');
    toast('离线海岸已导出 · 原件 '+result.mediaCount+' 个'+(result.warnings.length?' · 有缺失，请查看 manifest.json':' · 解压后打开 index.html'), 6500);
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
    if (name.startsWith('transfer-')) return transfer.handle(name,target);
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
      font: 'settings-font',
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
    if (name === 'set-font') {
      const fontMode = target.dataset.value;
      if (!['classic', 'soft', 'note'].includes(fontMode)) return;
      storage.update((state) => { state.preferences.fontMode = fontMode; });
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
    if (name === 'export-html') return exportHtml().catch(error => toast('离线归档失败：'+error.message, 5200));
    if (name === 'import-json') return importJson();
  }

  return Object.freeze({ handleAction });
}
