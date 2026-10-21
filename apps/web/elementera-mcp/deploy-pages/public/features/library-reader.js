import { escapeHtml, escapeAttribute } from '../core/dom.js';
import { renderReaderFragment } from './library-pages.js';

const attr = escapeAttribute;
export function renderTidalReader({ book, chapterTitle, chapterIndex, pages, pageIndex, notes, theme, fontSize }) {
  const current = pages[pageIndex] || [];
  const readerNote = notes.filter(n => n.kind === 'annotation' && n.start_offset == null && n.chapter_index === chapterIndex);
  const fragments = current.map(fragment => {
    const text = renderReaderFragment(fragment, notes.filter(n => n.chapter_index === chapterIndex), escapeHtml, attr);
    const legacy = readerNote.filter(n => n.paragraph_index === fragment.paragraph && fragment.start === 0)
      .map(n => '<aside class="tidal-reader-oldnote"><small>' + (n.author === 'owner' ? '用户' : '助手') + ' · 批注</small><p>' + escapeHtml(n.body) + '</p></aside>').join('');
    return '<div class="tidal-reader-fragment" data-paragraph="' + fragment.paragraph +
      '" data-start="' + fragment.start + '"><p>' + text + '</p>' + legacy + '</div>';
  }).join('');
  const chapterLinks = book.chapters.map(c => '<button type="button" data-action="library:chapter" data-book="' + attr(book.id) +
    '" data-index="' + c.chapter_index + '">' + escapeHtml(c.title) + '</button>').join('');
  const palette = [['paper','暖纸'], ['white','素白'], ['blue','雾蓝'], ['night','夜读']].map(([id,name]) =>
    '<option value="' + id + '"' + (id === theme ? ' selected' : '') + '>' + name + '</option>').join('');
  return '<section class="tidal-reader-frame" data-reader-chrome="hidden" data-reader-theme="' + attr(theme) + '" style="--reader-font-size:' + Number(fontSize) + 'px">' +
    '<div class="tidal-reader-top"><details class="tidal-reader-toc"><summary>目录</summary><div>' + chapterLinks + '</div></details>' +
    '<div class="tidal-reader-settings"><label>纸色 <select class="tidal-reader-color" aria-label="阅读器配色">' + palette + '</select></label>' +
    '<label>字号 <select class="tidal-reader-size" aria-label="阅读器字号">' + [14,15,16,17].map(n =>
      '<option value="' + n + '"' + (n === fontSize ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div></div>' +
    '<div class="tidal-reader-paper"><div class="tidal-reader-kicker">' + escapeHtml(book.title) + '</div>' +
    (/^(第\s*\d+\s*节)$/u.test(chapterTitle) ? '' : '<h2>' + escapeHtml(chapterTitle) + '</h2>') + '<div class="tidal-reader-lines">' + fragments + '</div></div>' +
    '<footer class="tidal-reader-footer">' +
    '<button type="button" data-action="library:page" data-book="' + attr(book.id) + '" data-index="' + chapterIndex + '" data-page="' + (pageIndex - 1) + '" ' + (pageIndex === 0 ? 'disabled' : '') + '>‹ 上一页</button>' +
    '<span>第 ' + (pageIndex + 1) + ' / ' + pages.length + ' 页</span>' +
    '<button type="button" data-action="library:page" data-book="' + attr(book.id) + '" data-index="' + chapterIndex + '" data-page="' + (pageIndex + 1) + '" ' + (pageIndex === pages.length - 1 ? 'disabled' : '') + '>下一页 ›</button></footer>' +
    '</section>';
}

export function attachTidalSelection(root, callback) {
  const frame = root.querySelector('.tidal-reader-frame');
  if (!frame) return;
  frame.addEventListener('click',event=>{
    if(event.target.closest('.tidal-reader-mark,.tidal-reader-toc,.tidal-reader-top,.tidal-reader-footer,.tidal-reader-popover'))return;
    if(window.getSelection()?.toString().trim())return;
    frame.dataset.readerChrome=frame.dataset.readerChrome==='shown'?'hidden':'shown';
  });
  let touchStartX = null;
  frame.addEventListener('touchstart', event => { touchStartX = event.touches[0]?.clientX ?? null; }, { passive: true });
  frame.addEventListener('touchend', event => {
    if (touchStartX == null || window.getSelection()?.toString().trim()) return;
    const distance = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) > 65) callback({ action: 'swipe', direction: distance < 0 ? 1 : -1 });
  }, { passive: true });
  const showSelection = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    const paraOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('.tidal-reader-fragment');
    const first = paraOf(range.startContainer), last = paraOf(range.endContainer);
    if (!first || first !== last || !frame.contains(first)) return;
    const para = first.querySelector('p');
    if (!para) return;
    const position = endpoint => {
      const r = document.createRange(); r.selectNodeContents(para);
      r.setEnd(endpoint === 'start' ? range.startContainer : range.endContainer, endpoint === 'start' ? range.startOffset : range.endOffset);
      return Number(first.dataset.start) + r.toString().length;
    };
    const from = position('start'), to = position('end');
    if (to <= from) return;
    callback({ action: 'select', paragraph: Number(first.dataset.paragraph), start_offset: from, end_offset: to,
      text: selection.toString(), rect: range.getBoundingClientRect() });
  };
  frame.addEventListener('mouseup', showSelection);
  frame.addEventListener('touchend', () => setTimeout(showSelection, 80), { passive: true });
}