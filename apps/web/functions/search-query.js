const DEFAULT_MAX_CHARS = 240;
const DEFAULT_MAX_TERMS = 10;
const DEFAULT_MAX_TERM_CHARS = 32;

function clipCharacters(value, max) {
  return Array.from(String(value ?? '')).slice(0, max).join('');
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHanWord(value) {
  return /^\p{Script=Han}+$/u.test(value);
}

function addTerm(terms, seen, value, maxTermChars, maxTerms) {
  const term = clipCharacters(value, maxTermChars);
  if (!term || seen.has(term) || terms.length >= maxTerms) return;
  seen.add(term);
  terms.push(term);
}

export function buildSafeSearchQuery(value, options = {}) {
  const maxChars = Math.max(1, Number(options.maxChars) || DEFAULT_MAX_CHARS);
  const maxTerms = Math.max(1, Number(options.maxTerms) || DEFAULT_MAX_TERMS);
  const maxTermChars = Math.max(2, Number(options.maxTermChars) || DEFAULT_MAX_TERM_CHARS);
  const input = String(value ?? '').trim();
  const query = clipCharacters(input, maxChars);
  const normalized = normalizedText(query);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const terms = [];
  const seen = new Set();

  for (const word of words) {
    addTerm(terms, seen, word, maxTermChars, maxTerms);
    const characters = Array.from(word);
    if (!isHanWord(word) || characters.length < 4) continue;
    for (let index = 0; index < characters.length - 1 && terms.length < maxTerms; index += 2) {
      addTerm(terms, seen, characters.slice(index, index + 2).join(''), maxTermChars, maxTerms);
    }
  }

  const possibleTermCount = words.reduce((count, word) => {
    const length = Array.from(word).length;
    return count + 1 + (isHanWord(word) && length >= 4 ? Math.ceil((length - 1) / 2) : 0);
  }, 0);

  return {
    query,
    normalized,
    terms,
    degraded: Array.from(input).length > maxChars
      || possibleTermCount > maxTerms
      || words.some((word) => Array.from(word).length > maxTermChars),
  };
}

export function searchTextScore(value, search) {
  if (!search?.terms?.length) return 1;
  const haystack = normalizedText(value);
  if (!haystack) return 0;
  if (search.normalized && haystack.includes(search.normalized)) return 2;
  const compactHaystack = haystack.replace(/\s+/g, '');
  const matched = search.terms.filter((term) => compactHaystack.includes(term.replace(/\s+/g, ''))).length;
  return matched ? matched / search.terms.length : 0;
}

export function rankSearchRecords(records, search, textForRecord = (record) => JSON.stringify(record)) {
  if (!search?.terms?.length) return [...records];
  return records
    .map((record, index) => ({
      record,
      index,
      score: searchTextScore(textForRecord(record), search),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.record);
}

export function searchMetadata(search) {
  return {
    mode: 'bounded_keyword',
    normalized_query: search.normalized,
    effective_terms: [...search.terms],
    degraded: Boolean(search.degraded),
  };
}
