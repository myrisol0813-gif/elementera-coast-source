function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function hasSoil(soil) {
  return Boolean(clip(soil?.current_text, 1)
    || (Array.isArray(soil?.hand_seeds) && soil.hand_seeds.length)
    || clip(soil?.do_not_repeat, 1));
}

function seedText(seed) {
  const name = clip(seed?.name || seed?.title, 90);
  const core = clip(seed?.life_core || seed?.content, 360);
  return [name, core].filter(Boolean).join('｜');
}

function soilLines(soil, { currentLimit, maxHandSeeds, includeLabel = false } = {}) {
  if (!hasSoil(soil)) return [];
  const lines = [];
  if (includeLabel) lines.push(`${clip(soil.display_author || soil.source_label || '房间纸条', 80)}：`);
  const current = clip(soil.current_text, currentLimit);
  if (current) lines.push(`当前：${current}`);
  const seeds = (Array.isArray(soil.hand_seeds) ? soil.hand_seeds : [])
    .map(seedText)
    .filter(Boolean)
    .slice(0, maxHandSeeds);
  if (seeds.length) lines.push('当前活跃线索：', ...seeds.map((seed) => `- ${seed}`));
  const doNotRepeat = clip(soil.do_not_repeat, 600);
  if (doNotRepeat) lines.push(`勿复读：${doNotRepeat}`);
  return lines;
}

export function formatThinkingSoil(value, {
  maxCharacters = 1800,
  maxHandSeeds = 7,
} = {}) {
  const limit = Math.max(300, Math.min(4000, Number(maxCharacters) || 1800));
  let lines = [];
  if (value?.sources && typeof value.sources === 'object') {
    for (const soil of Object.values(value.sources)) {
      lines.push(...soilLines(soil, {
        currentLimit: Math.max(240, Math.floor(limit / 2)),
        maxHandSeeds: Math.max(1, Math.ceil(maxHandSeeds / 2)),
        includeLabel: true,
      }));
    }
  } else {
    const soil = value?.soil || value;
    lines = soilLines(soil, { currentLimit: limit, maxHandSeeds });
  }
  if (!lines.length) return '';
  return `【整理当前对话的纸条】\n${lines.join('\n')}`.slice(0, limit);
}
