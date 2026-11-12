import { listCalendarEntries } from './calendar-store.js';

export const REALITY_FIELD_LABELS = Object.freeze({
  date: '日期',
  time: '时间',
  battery: '电量',
  weather: '天气',
  location: '位置',
  recent_app: '最近使用 App',
  app_usage: '今日 App 使用时间',
  calendar: '未来 7 天日历',
  steps: '步数',
});

export const APP_USAGE_LIMIT = 5;

const weatherLocationCache = new Map();
const weatherNowCache = new Map();

const WEATHER_CODES = Object.freeze({
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴', 45: '有雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '强阵雪',
  95: '雷雨', 96: '雷雨伴小冰雹', 99: '雷雨伴冰雹',
});

export const SHORT_REPLY_PROMPT = [
  '当前对话开启了短句模式。',
  '优先像日常即时聊天一样自然、简短地回应，不主动把普通一句话扩写成长篇分析、总结或 deep talk。',
  '可以停顿、短答、接话，也可以只回应最靠近此刻的部分。',
  '若用户的问题本身需要解释，或谈话自然进入深入讨论，则不必为了短而截断内容。',
  '不要因为短句模式而变得冷淡、客服化或失去原本的关系语气。',
].join('\n');

function clip(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validDate(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? '' : raw;
}

function addUtcDays(day, amount) {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function localTime(value) {
  const match = /(?:^|T|\s)(\d{2}:\d{2})(?::\d{2})?/.exec(String(value || '').trim());
  return match?.[1] || '';
}

function integer(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function cleanBattery(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const percent = integer(value.percent, 0, 100);
  if (percent == null) return '';
  const charging = value.charging === true ? '正在充电' : value.charging === false ? '未充电' : '';
  return [`${percent}%`, charging].filter(Boolean).join(' · ');
}

function cleanLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return clip(value.label, 120);
}

function cleanRecentApp(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return clip(value.name, 120);
}

function durationText(minutes) {
  const value = integer(minutes, 0, 1440);
  if (value == null) return '';
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours && rest) return `${hours}h${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

function cleanAppUsage(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const name = clip(item?.name, 100);
      const duration = durationText(item?.minutes);
      return name && duration ? `${name} ${duration}` : '';
    })
    .filter(Boolean)
    .slice(0, APP_USAGE_LIMIT)
    .join(' · ');
}

function cleanSteps(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const count = integer(value.count, 0, 200000);
  if (count == null) return '';
  const basis = clip(value.basis, 80);
  return [basis, `${count} 步`].filter(Boolean).join(' · ');
}

async function weatherForCity(city) {
  const cleanCity = clip(city, 80);
  if (!cleanCity || typeof fetch !== 'function') return '';
  const now = Date.now();
  const cachedNow = weatherNowCache.get(cleanCity);
  if (cachedNow && cachedNow.expires_at > now) return cachedNow.text;

  let location = weatherLocationCache.get(cleanCity);
  if (!location) {
    const query = new URL('https://geocoding-api.open-meteo.com/v1/search');
    query.searchParams.set('name', cleanCity);
    query.searchParams.set('count', '1');
    query.searchParams.set('language', 'zh');
    query.searchParams.set('format', 'json');
    const response = await fetch(query.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) return '';
    const result = await response.json();
    const row = Array.isArray(result?.results) ? result.results[0] : null;
    if (!row || !Number.isFinite(Number(row.latitude)) || !Number.isFinite(Number(row.longitude))) return '';
    location = {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      label: [row.name, row.admin1, row.country]
        .map((item) => clip(item, 60)).filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index).join(' · '),
    };
    weatherLocationCache.set(cleanCity, location);
  }

  const query = new URL('https://api.open-meteo.com/v1/forecast');
  query.searchParams.set('latitude', String(location.latitude));
  query.searchParams.set('longitude', String(location.longitude));
  query.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code');
  query.searchParams.set('temperature_unit', 'celsius');
  query.searchParams.set('timezone', 'auto');
  const response = await fetch(query.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) return '';
  const result = await response.json();
  const current = result?.current || {};
  const temperature = Number(current.temperature_2m);
  const apparent = Number(current.apparent_temperature);
  const code = integer(current.weather_code, 0, 999);
  if (!Number.isFinite(temperature)) return '';
  const condition = WEATHER_CODES[code] || (code == null ? '' : `天气代码 ${code}`);
  const text = [
    location.label || cleanCity,
    condition,
    `${Math.round(temperature)}°C`,
    Number.isFinite(apparent) ? `体感 ${Math.round(apparent)}°C` : '',
  ].filter(Boolean).join(' · ');
  weatherNowCache.set(cleanCity, { text, expires_at: now + 10 * 60 * 1000 });
  return text;
}

async function upcomingCalendarText(db, localDate) {
  const start = validDate(localDate);
  if (!start) return '';
  const days = Array.from({ length: 7 }, (_, index) => addUtcDays(start, index));
  const daySet = new Set(days);
  const months = [...new Set(days.map((day) => day.slice(0, 7)))];
  const lists = await Promise.all(months.map((month) => listCalendarEntries(db, { month })));
  const entries = lists.flat()
    .filter((entry) => entry?.kind === 'event' && daySet.has(String(entry.occurrence_day || entry.day || '')))
    .sort((left, right) => String(left.occurrence_day || left.day).localeCompare(String(right.occurrence_day || right.day))
      || Number(left.created_at || 0) - Number(right.created_at || 0));
  if (!entries.length) return '未来 7 天无重要日期';
  return entries.map((entry) => `${entry.occurrence_day || entry.day}｜${clip(entry.title, 120)}`).join('\n');
}

function selectedFields(settings) {
  return settings?.reality_enabled === true && Array.isArray(settings?.reality_fields)
    ? [...new Set(settings.reality_fields.map(String))].filter((key) => Object.hasOwn(REALITY_FIELD_LABELS, key))
    : [];
}

export async function buildRealityContext(env, {
  settings = {}, snapshot = {}, localDate = '', localDateTime = '',
} = {}) {
  const selected = selectedFields(settings);
  if (!settings?.reality_enabled) return { enabled: false, selected: [], delivered: [], missing: [], text: '' };
  const safeSnapshot = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  const delivered = [];
  const missing = [];
  const add = (key, text) => {
    if (!selected.includes(key)) return;
    const clean = String(text || '').trim();
    if (clean) delivered.push({ key, label: REALITY_FIELD_LABELS[key], text: clean });
    else missing.push(REALITY_FIELD_LABELS[key]);
  };

  add('date', validDate(localDate));
  add('time', [localTime(localDateTime), clip(safeSnapshot.timezone, 80)].filter(Boolean).join(' · '));
  add('battery', cleanBattery(safeSnapshot.battery));
  if (selected.includes('weather')) {
    let weatherText = '';
    try { weatherText = await weatherForCity(settings.weather_city); } catch { weatherText = ''; }
    add('weather', weatherText);
  }
  add('location', cleanLocation(safeSnapshot.location));
  add('recent_app', cleanRecentApp(safeSnapshot.recent_app));
  add('app_usage', cleanAppUsage(safeSnapshot.app_usage));
  if (selected.includes('calendar')) {
    try { add('calendar', await upcomingCalendarText(env.COAST_CHAT_DB, localDate)); }
    catch { missing.push(REALITY_FIELD_LABELS.calendar); }
  }
  add('steps', cleanSteps(safeSnapshot.steps));

  return {
    enabled: true,
    selected,
    delivered,
    missing: [...new Set(missing)],
    text: delivered.map((item) => `${item.label}：${item.text}`).join('\n'),
  };
}

export function responseModeContext(settings = {}) {
  const enabled = settings?.short_reply_mode === true;
  return { short_reply_mode: enabled, text: enabled ? SHORT_REPLY_PROMPT : '' };
}
