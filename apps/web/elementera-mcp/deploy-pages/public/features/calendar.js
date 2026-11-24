import { requestJson, API } from '../core/api.js';
import { escapeHtml, escapeAttribute } from '../core/dom.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayIn = (month, d) => `${month}-${String(d).padStart(2, '0')}`;
const monthShift = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  if (d.getFullYear() < 1900 || d.getFullYear() > 2200) return month;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthTitle = (month) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;

export function createCalendar({ router, toast }) {
  const state = { month: today().slice(0, 7), day: today(), entries: [], busy: false, ready: false, error: '' };
  let root = null, pinnedRoot = null, pinnedTimer = null;
  let pinnedEntries = [], pinnedError = '';
  let pinnedRevision = 0;

  function renderPinned() {
    if (!pinnedRoot) return;
    const display = entry => {
      const status = entry.status;
      const value = status?.phase === 'today' ? '今天' : status?.phase === 'no_future_occurrence' ? '无下次日期' : String(status?.days ?? '—');
      const unit = status?.phase === 'elapsed' ? '日' : status?.phase === 'upcoming' ? '天后' : status?.phase === 'past' ? '天前' : '';
      return '<button type="button" class="coast-status-card" data-action="calendar:anniversary-edit" data-id="' + escapeAttribute(entry.id) + '"><span>' + escapeHtml(entry.title) + '</span><b>' + escapeHtml(value) + '</b><span>' + escapeHtml(unit) + '</span></button>';
    };
    pinnedRoot.innerHTML = pinnedEntries.map(display).join('')
      + '<button class="coast-status-card coast-status-add" type="button" data-action="calendar:anniversary-new">＋<span>纪念日</span></button>'
      + (pinnedError ? '<button class="coast-status-card" type="button" data-action="calendar:pinned-reload">读取失败<span>重试</span></button>' : '');
  }

  async function loadPinned() {
    const revision = ++pinnedRevision;
    const requestedDate = today();
    try {
      const result = await requestJson(API.calendarEntries + '?pinned=1&today=' + encodeURIComponent(requestedDate));
      if (revision !== pinnedRevision || !pinnedRoot) return;
      pinnedEntries = result.entries || [];
      pinnedError = '';
    } catch (error) {
      if (revision !== pinnedRevision || !pinnedRoot) return;
      pinnedEntries = [];
      pinnedError = error?.message || '无法读取纪念日。';
    } finally {
      if (revision === pinnedRevision) renderPinned();
    }
  }
  const ownsRoute = (route) => ['calendar', 'calendar-edit'].includes(route?.name);

  function scheduleDateRollover() {
    clearTimeout(pinnedTimer);
    const next = new Date();
    next.setHours(24, 0, 0, 50);
    pinnedTimer = setTimeout(() => {
      if (!pinnedRoot) return;
      void loadPinned();
      scheduleDateRollover();
    }, Math.max(100, next.getTime() - Date.now()));
  }

  async function load() {
    if (state.busy) return;
    state.busy = true;
    const requestedMonth = state.month;
    state.error = '';
    try {
      const result = await requestJson(`${API.calendarEntries}?month=${encodeURIComponent(requestedMonth)}`);
      if (requestedMonth === state.month) {
        state.entries = result.entries || [];
        state.ready = true;
      }
    } catch (error) {
      if (requestedMonth === state.month) state.error = error?.message || '无法读取日历。';
    } finally {
      state.busy = false;
      if (requestedMonth !== state.month) void load();
      else if (router.current()?.name === 'calendar') await router.refresh({ preserveScroll: true });
    }
  }

  const card = (entry) => `<article class="coast-calendar-entry">
    <div><strong>${escapeHtml(entry.title)}</strong><small>${entry.anniversary ? '纪念日' : entry.kind === 'note' ? '随记' : '日程'} · ${escapeHtml(entry.author === 'owner' ? '用户' : '助手')}${entry.recurrence === 'yearly' ? ' · 每年' : ''}${entry.anniversary?.pinned ? ' · 侧栏展示' : ''}</small></div>
    ${entry.body ? `<p>${escapeHtml(entry.body)}</p>` : ''}
    <button type="button" data-action="calendar:edit" data-id="${escapeAttribute(entry.id)}">编辑</button>
  </article>`;

  function calendarView() {
    if (!state.ready && !state.busy) void load();
    const [y, m] = state.month.split('-').map(Number);
    const firstWeekday = new Date(y, m - 1, 1).getDay();
    const lastDay = new Date(y, m, 0).getDate();
    const visible = state.entries.filter((entry) => entry.occurrence_day === state.day);
    const squares = Array.from({ length: firstWeekday + lastDay }, (_, index) => {
      const d = index - firstWeekday + 1;
      if (d < 1) return '<span class="coast-calendar-blank" aria-hidden="true"></span>';
      const key = dayIn(state.month, d);
      const count = state.entries.filter((entry) => entry.occurrence_day === key).length;
      return `<button class="coast-calendar-day${key === state.day ? ' is-selected' : ''}" type="button" data-action="calendar:day" data-day="${key}" aria-pressed="${key === state.day}"><span>${d}</span>${count ? `<i aria-label="${count} 条记录"></i>` : ''}</button>`;
    }).join('');
    return {
      title: '日历', subtitle: '公历 · 日程与随记', className: 'coast-calendar-panel',
      headerAction: '<button class="feature-head-action" data-action="calendar:new" type="button">＋ 记录</button>',
      body: `<section class="coast-calendar-shell">
        <div class="coast-calendar-month"><button data-action="calendar:previous" type="button" aria-label="上个月">‹</button><strong>${monthTitle(state.month)}</strong><button data-action="calendar:next" type="button" aria-label="下个月">›</button></div>
        <div class="coast-calendar-grid">${['日','一','二','三','四','五','六'].map((v) => `<span class="coast-calendar-week">${v}</span>`).join('')}${squares}</div>
        <div class="coast-calendar-detail"><h2>${escapeHtml(state.day)} <small>${visible.length} 条记录</small></h2>
          ${state.error ? `<p class="coast-calendar-error">${escapeHtml(state.error)}</p><button type="button" data-action="calendar:reload">重试</button>` : ''}
          ${state.busy && !state.ready ? '<p class="feature-note">正在翻阅日历…</p>' : ''}
          ${visible.length ? visible.map(card).join('') : '<p class="feature-empty">这一天还没有记录。</p>'}
          <button class="coast-calendar-add" data-action="calendar:new" type="button">＋ 在这一天记一笔</button>
        </div>
      </section>`,
    };
  }

  function editView({ id = '', anniversary = false, fromSidebar = false } = {}) {
    const entry = (fromSidebar ? pinnedEntries : state.entries).find(item => item.id === id);
    if (id && !entry) return { title: '记录暂不可读', body: '<p class="feature-empty">请返回后重新读取日历。</p>' };
    const ann = entry?.anniversary;
    const kind = ann || anniversary ? 'anniversary' : entry?.kind || 'event';
    const day = ann?.startDay || entry?.day || (fromSidebar ? today() : state.day);
    const mode = ann?.mode || 'elapsed';
    const pinned = ann?.pinned ?? fromSidebar;
    return {
      title: entry ? '修改日历记录' : '新建日历记录', subtitle: '轻轻留一张公历纸条', className: 'coast-calendar-panel',
      body: `<section class="coast-calendar-editor">
        <label><span id="calendarDayLabel">${kind === 'anniversary' ? '起始日期' : '日期'}</span><input id="calendarDay" type="date" min="1900-01-01" max="2200-12-31" value="${escapeAttribute(day)}"></label>
        <label>标题 <small>最多 120 字</small><input id="calendarTitle" maxlength="120" value="${escapeAttribute(entry?.title || '')}" placeholder="今天有什么想记住的？"></label>
        <label>类型<select id="calendarKind" data-change="calendar:kind"><option value="event"${kind === 'event' ? ' selected' : ''}>日程</option><option value="note"${kind === 'note' ? ' selected' : ''}>当天随记</option><option value="anniversary"${kind === 'anniversary' ? ' selected' : ''}>纪念日</option></select></label>
        <label id="calendarRecurrenceField"${kind === 'anniversary' ? ' hidden' : ''}>重复<select id="calendarRecurrence"><option value="none"${entry?.recurrence !== 'yearly' ? ' selected' : ''}>不重复</option><option value="yearly"${entry?.recurrence === 'yearly' ? ' selected' : ''}>每年此日</option></select></label>
        <div id="calendarAnniversaryFields" class="coast-anniversary-fields"${kind !== 'anniversary' ? ' hidden' : ''}>
          <label>计算方式<select id="calendarAnniversaryMode" data-change="calendar:mode"><option value="elapsed"${mode === 'elapsed' ? ' selected' : ''}>从起始日起计时</option><option value="milestone"${mode === 'milestone' ? ' selected' : ''}>第 N 天倒数</option><option value="yearly"${mode === 'yearly' ? ' selected' : ''}>每年纪念日倒数</option></select></label>
          <label id="calendarTargetField"${mode !== 'milestone' ? ' hidden' : ''}>目标天数<input id="calendarTargetDays" type="number" min="1" max="109938" step="1" value="${escapeAttribute(String(ann?.targetDays ?? 100))}"></label>
          <label class="coast-calendar-check"><input id="calendarPinned" type="checkbox"${pinned ? ' checked' : ''}>在侧栏展示</label>
          <small>起始日期为第 1 天；纪念日会同步显示在日历。不在侧栏展示不会删除记录。2 月 29 日仅在闰年重复。</small>
        </div>
        <label>内容 <small>最多 4000 字</small><textarea id="calendarBody" rows="5" maxlength="4000" placeholder="可留空。">${escapeHtml(entry?.body || '')}</textarea></label>
        <button class="coast-calendar-submit" type="button" data-action="calendar:save" data-id="${escapeAttribute(entry?.id || '')}">保存日历记录</button>
        ${entry ? `<button class="coast-calendar-remove" type="button" data-action="calendar:delete" data-id="${escapeAttribute(entry.id)}">删除这条记录</button>` : ''}
      </section>`,
    };
  }

  async function save(target) {
    if (state.busy) return;
    const kind = root.querySelector('#calendarKind')?.value || 'event';
    const mode = root.querySelector('#calendarAnniversaryMode')?.value || 'elapsed';
    const date = root.querySelector('#calendarDay')?.value || '';
    const entry = {
      day: date,
      title: root.querySelector('#calendarTitle')?.value || '',
      body: root.querySelector('#calendarBody')?.value || '',
      kind: kind === 'anniversary' ? 'event' : kind,
      recurrence: kind === 'anniversary' ? (mode === 'yearly' ? 'yearly' : 'none') : root.querySelector('#calendarRecurrence')?.value || 'none',
      anniversary: kind === 'anniversary' ? {
        startDay: date, mode,
        targetDays: mode === 'milestone' ? Number(root.querySelector('#calendarTargetDays')?.value) : null,
        pinned: Boolean(root.querySelector('#calendarPinned')?.checked),
      } : null,
    };
    if (!entry.title.trim()) { toast('先给这一天写个标题。'); return; }
    state.busy = true;
    try {
      const id = target.dataset.id || '';
      const result = await requestJson(id ? `${API.calendarEntries}/${encodeURIComponent(id)}` : API.calendarEntries, {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(entry),
      });
      state.day = result.entry.day;
      state.month = state.day.slice(0, 7);
      state.ready = false;
      void loadPinned();
      toast(id ? '记录已经改好。' : '这一笔已经记下。');
      await router.open('calendar', {}, { replace: true });
    } catch (error) { toast(error?.message || '保存失败。', 3800); }
    finally { state.busy = false; void load(); }
  }

  async function handleEvent(_event, context) {
    const name = context.name, target = context.target;
    if (name === 'kind' || name === 'mode') {
      const ann = root.querySelector('#calendarKind')?.value === 'anniversary';
      root.querySelector('#calendarDayLabel').textContent = ann ? '起始日期' : '日期';
      root.querySelector('#calendarAnniversaryFields').hidden = !ann;
      root.querySelector('#calendarRecurrenceField').hidden = ann;
      root.querySelector('#calendarTargetField').hidden = root.querySelector('#calendarAnniversaryMode')?.value !== 'milestone';
      return;
    }
    if (name === 'anniversary-new') return router.open('calendar-edit', { anniversary: true, fromSidebar: true });
    if (name === 'anniversary-edit') return router.open('calendar-edit', { id: target.dataset.id, fromSidebar: true });
    if (name === 'pinned-reload') return loadPinned();
    if (name === 'open') return router.open('calendar');
    if (name === 'previous' || name === 'next') {
      state.month = monthShift(state.month, name === 'previous' ? -1 : 1);
      state.day = `${state.month}-01`;
      state.ready = false;
      void load(); return router.refresh();
    }
    if (name === 'day') { state.day = target.dataset.day; return router.refresh(); }
    if (name === 'new') return router.open('calendar-edit');
    if (name === 'edit') return router.open('calendar-edit', { id: target.dataset.id });
    if (name === 'save') return save(target);
    if (name === 'reload') return load();
    if (name === 'delete') {
      if (!globalThis.confirm?.('确定删除这条日历记录吗？')) return;
      try {
        await requestJson(`${API.calendarEntries}/${encodeURIComponent(target.dataset.id)}`, { method: 'DELETE' });
        toast('日历记录已经删除。');
        void loadPinned();
        await router.open('calendar', {}, { replace: true });
        void load();
      } catch (error) { toast(error?.message || '删除失败。', 3600); }
    }
  }

  router.register('calendar', calendarView);
  router.register('calendar-edit', editView);

  return Object.freeze({
    id: 'calendar', priority: 72, mountOrder: 66, ownsRoute,
    ownsEvent(_event, context) {
      if (context.namespace !== 'calendar') return false;
      if (context.eventType === 'click') return { preventDefault: true };
      return context.eventType === 'change';
    },
    observeEvent(_event, context) { if (context.route === 'shell:open-sidebar') void loadPinned(); },
    handleEvent,
    mount(context = {}) {
      root = context.overlayRoot || document.querySelector('#overlayRoot');
      pinnedRoot = document.querySelector('#coastAnniversaryCards');
      if (pinnedRoot) {
        renderPinned();
        void loadPinned();
        scheduleDateRollover();
      }
    },
    refresh() {},
    destroy() {
      clearTimeout(pinnedTimer); pinnedTimer = null; pinnedRevision++;
      pinnedRoot = null; root = null; pinnedEntries = [];
    },
  });
}
