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
  let root = null;
  const ownsRoute = (route) => ['calendar', 'calendar-edit'].includes(route?.name);

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
      else if (ownsRoute(router.current())) await router.refresh({ preserveScroll: true });
    }
  }

  const card = (entry) => `<article class="coast-calendar-entry">
    <div><strong>${escapeHtml(entry.title)}</strong><small>${entry.kind === 'note' ? '随记' : '日程'} · ${escapeHtml(entry.author === 'owner' ? '用户' : '助手')}${entry.recurrence === 'yearly' ? ' · 每年' : ''}</small></div>
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

  function editView({ id = '' } = {}) {
    const entry = state.entries.find((item) => item.id === id);
    const day = entry?.day || state.day;
    return {
      title: entry ? '修改日历记录' : '新建日历记录', subtitle: '新建或编辑公历记录', className: 'coast-calendar-panel',
      body: `<section class="coast-calendar-editor">
        <label>日期<input id="calendarDay" type="date" value="${escapeAttribute(day)}"></label>
        <label>标题 <small>最多 120 字</small><input id="calendarTitle" maxlength="120" value="${escapeAttribute(entry?.title || '')}" placeholder="今天有什么想记住的？"></label>
        <label>类型<select id="calendarKind"><option value="event"${entry?.kind !== 'note' ? ' selected' : ''}>日程 / 纪念日</option><option value="note"${entry?.kind === 'note' ? ' selected' : ''}>当天随记</option></select></label>
        <label>重复<select id="calendarRecurrence"><option value="none"${entry?.recurrence !== 'yearly' ? ' selected' : ''}>不重复</option><option value="yearly"${entry?.recurrence === 'yearly' ? ' selected' : ''}>每年此日</option></select></label>
        <label>内容 <small>最多 4000 字</small><textarea id="calendarBody" rows="5" maxlength="4000" placeholder="可留空。">${escapeHtml(entry?.body || '')}</textarea></label>
        <button class="coast-calendar-submit" type="button" data-action="calendar:save" data-id="${escapeAttribute(entry?.id || '')}">保存日历记录</button>
        ${entry ? `<button class="coast-calendar-remove" type="button" data-action="calendar:delete" data-id="${escapeAttribute(entry.id)}">删除这条记录</button>` : ''}
      </section>`,
    };
  }

  async function save(target) {
    if (state.busy) return;
    const entry = {
      day: root.querySelector('#calendarDay')?.value || '',
      title: root.querySelector('#calendarTitle')?.value || '',
      body: root.querySelector('#calendarBody')?.value || '',
      kind: root.querySelector('#calendarKind')?.value || 'event',
      recurrence: root.querySelector('#calendarRecurrence')?.value || 'none',
    };
    if (!entry.title.trim()) { toast('先给这一天写个标题。'); return; }
    state.busy = true;
    try {
      const id = target.dataset.id || '';
      await requestJson(id ? `${API.calendarEntries}/${encodeURIComponent(id)}` : API.calendarEntries, {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(entry),
      });
      state.month = entry.day.slice(0, 7);
      state.day = entry.day;
      toast(id ? '记录已经改好。' : '这一笔已经记下。');
      await router.open('calendar', {}, { replace: true });
    } catch (error) { toast(error?.message || '保存失败。', 3800); }
    finally { state.busy = false; void load(); }
  }

  async function handleEvent(_event, context) {
    const name = context.name, target = context.target;
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
        await router.open('calendar', {}, { replace: true });
        void load();
      } catch (error) { toast(error?.message || '删除失败。', 3600); }
    }
  }

  router.register('calendar', calendarView);
  router.register('calendar-edit', editView);

  return Object.freeze({
    id: 'calendar', priority: 72, mountOrder: 66, ownsRoute,
    ownsEvent(_event, context) { return context.namespace === 'calendar' && context.eventType === 'click' ? { preventDefault: true } : false; },
    handleEvent,
    mount(context = {}) { root = context.overlayRoot || document.querySelector('#overlayRoot'); },
    refresh() {}, destroy() { root = null; },
  });
}
