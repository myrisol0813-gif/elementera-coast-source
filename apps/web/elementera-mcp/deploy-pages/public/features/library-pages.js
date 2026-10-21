// Reader pages are reflowable, not fixed paragraphs. All indices refer to the
// exact stored plaintext, so changing font size never shifts saved highlights.
export const READER_SIZES = Object.freeze({ compact: 14, standard: 15, relaxed: 17 });
export const READER_COLORS = Object.freeze(['paper', 'white', 'blue', 'night']);

export function paginateReaderParagraphs(paragraphs, budget = 520) {
  if (!Number.isInteger(budget) || budget < 180 || budget > 1200) throw new RangeError('Invalid reader page budget');
  const pages = [];
  let current = [], count = 0;
  const flush = () => {
    if (current.length) pages.push(current);
    current = []; count = 0;
  };
  for (const paragraph of paragraphs) {
    const full = String(paragraph.text ?? '');
    let pos = 0;
    while (pos < full.length) {
      const room = budget - count;
      if (room <= 0) { flush(); continue; }
      let end = Math.min(full.length, pos + room);
      if (end < full.length && end - pos > 100) {
        // Prefer a punctuation boundary, but never drop any source character.
        const point = Math.max(
          full.lastIndexOf('。', end - 1), full.lastIndexOf('？', end - 1),
          full.lastIndexOf('！', end - 1), full.lastIndexOf('，', end - 1),
          full.lastIndexOf(' ', end - 1)
        );
        if (point > pos + Math.floor((end - pos) * .66)) end = point + 1;
      }
      if (end <= pos) end = Math.min(full.length, pos + room);
      const text = full.slice(pos, end);
      current.push({ paragraph: paragraph.index, start: pos, end, text });
      count += text.length;
      pos = end;
      if (count >= budget) flush();
    }
    // Retain the paragraph break when there is space on this page.
    if (count + 2 > budget) flush();
    else count += 2;
  }
  flush();
  return pages.length ? pages : [[]];
}

export function readerPageForParagraph(pages, paragraph, offset = 0) {
  const page = pages.findIndex(items => items.some(fragment => fragment.paragraph === paragraph &&
    fragment.start <= offset && fragment.end > offset));
  return page < 0 ? 0 : page;
}

export function renderReaderFragment(fragment, notes, escapeHtml, escapeAttr) {
  const highlights = notes.filter(note =>
    note.paragraph_index === fragment.paragraph &&
    Number.isInteger(note.start_offset) && Number.isInteger(note.end_offset) &&
    note.end_offset > fragment.start && note.start_offset < fragment.end
  ).sort((a, b) => a.start_offset - b.start_offset || a.end_offset - b.end_offset);
  const pieces = [];
  let cursor = fragment.start;
  const whole = fragment.text;
  for (const note of highlights) {
    const from = Math.max(note.start_offset, fragment.start, cursor);
    const to = Math.min(note.end_offset, fragment.end);
    if (to <= from) continue;
    pieces.push(escapeHtml(whole.slice(cursor - fragment.start, from - fragment.start)));
    pieces.push('<mark class="tidal-reader-mark" data-action="library:mark" data-id="' +
      escapeAttr(note.id) + '" data-author="' + escapeAttr(note.author) + '">' +
      escapeHtml(whole.slice(from - fragment.start, to - fragment.start)) + '</mark>');
    cursor = to;
  }
  pieces.push(escapeHtml(whole.slice(cursor - fragment.start)));
  return pieces.join('');
}
