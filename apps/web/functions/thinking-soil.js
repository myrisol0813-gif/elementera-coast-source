function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function hasSoil(soil) {
  return Boolean(clip(soil?.current_text, 1)
    || (Array.isArray(soil?.afterthoughts) && soil.afterthoughts.some((item) => clip(item, 1))));
}

function soilLines(soil, { currentLimit, maxAfterthoughts, includeLabel = false } = {}) {
  if (!hasSoil(soil)) return [];
  const lines = [];
  if (includeLabel) lines.push(`${clip(soil.display_author || soil.source_label || '房间纸条', 80)}：`);
  const current = clip(soil.current_text, currentLimit);
  if (current) lines.push(`当前：${current}`);
  const afterthoughts = (Array.isArray(soil.afterthoughts) ? soil.afterthoughts : [])
    .map((item) => clip(item, 420))
    .filter(Boolean)
    .slice(0, maxAfterthoughts);
  if (afterthoughts.length) lines.push('余思：', ...afterthoughts.map((item) => `- ${item}`));
  return lines;
}

export function isThinkingSoilEnabled(value) {
  if (value?.sources && typeof value.sources === 'object') {
    return Object.values(value.sources).some((soil) => soil?.auto_refresh_enabled !== false);
  }
  const soil = value?.soil || value;
  return soil?.auto_refresh_enabled !== false;
}

export function formatThinkingSoil(value, {
  maxCharacters = 1800,
  maxAfterthoughts = 7,
} = {}) {
  const limit = Math.max(300, Math.min(4000, Number(maxCharacters) || 1800));
  let lines = [];
  if (value?.sources && typeof value.sources === 'object') {
    for (const soil of Object.values(value.sources)) {
      if (!isThinkingSoilEnabled(soil)) continue;
      lines.push(...soilLines(soil, {
        currentLimit: Math.max(240, Math.floor(limit / 2)),
        maxAfterthoughts: Math.max(1, Math.ceil(maxAfterthoughts / 2)),
        includeLabel: true,
      }));
    }
  } else {
    const soil = value?.soil || value;
    if (!isThinkingSoilEnabled(soil)) return '';
    lines = soilLines(soil, { currentLimit: limit, maxAfterthoughts });
  }
  if (!lines.length) return '';
  return `【整理当前对话的纸条】\n${lines.join('\n')}`.slice(0, limit);
}
