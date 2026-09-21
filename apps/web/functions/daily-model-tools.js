import { DailyStoreError, addMomentComment, createDiary, createMoment, listMoments, setMomentLike } from './daily-store.js';
import { apiModelPartnerIdentity } from './coast-identity.js';

const LATEST_MOMENT_ALIASES = new Set([
  'latest',
  'newest',
  '最新',
  '最新动态',
  '最新朋友圈',
  '刚发的',
  '刚刚那条',
]);

const CREATE_MOMENT = {
  type: 'function',
  function: {
    name: 'create_moment',
    description: '直接写入一条正式的 Elementera Coast 碳硅圈动态。用户明确说“发碳硅圈 / 发朋友圈 / 写动态”时应调用本工具。不会外发到任何社交平台；写入后可在「小组件 > 碳硅圈」找到。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 12000 }, date: { type: 'string', description: 'YYYY-MM-DD，可省略。' }, reason: { type: 'string', maxLength: 1000 } },
      required: ['text'],
    },
  },
};
const CREATE_DIARY = {
  type: 'function',
  function: {
    name: 'create_diary',
    description: '直接写入一篇正式日记，不经过草稿发布流程。用户明确说“写进日记 / 记到日记 / 帮我存成日记”时应调用本工具。写入后可在「小组件 > 日记」找到。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 24000 },
        date: { type: 'string', description: 'YYYY-MM-DD，可省略。' },
        weather: { type: 'string', maxLength: 80 },
        mood: { type: 'string', maxLength: 120 },
        tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } },
        conflict_mode: { type: 'string', enum: ['append', 'replace'] },
        replace_id: { type: 'string', maxLength: 160 },
      },
      required: ['text'],
    },
  },
};
const MOMENT_COMMENT = {
  type: 'function',
  function: {
    name: 'moment_comment',
    description: '以当前 API 模型伙伴 身份评论一条碳硅圈动态。moment_id 可传具体动态 ID；如果用户说“最新朋友圈 / 刚发那条 / 最新动态”，可传 "latest"，工具会解析为最新一条已发布碳硅圈。工具只负责落笔保存，不额外生成评论正文。',
    parameters: { type: 'object', additionalProperties: false, properties: { moment_id: { type: 'string', maxLength: 160 }, text: { type: 'string', maxLength: 2000 } }, required: ['moment_id', 'text'] },
  },
};
const MOMENT_LIKE = {
  type: 'function',
  function: {
    name: 'moment_like',
    description: '以当前 API 模型伙伴 身份点赞或取消点赞一条碳硅圈动态。moment_id 可传具体动态 ID；如果用户说“最新朋友圈 / 刚发那条 / 最新动态”，可传 "latest"，工具会解析为最新一条已发布碳硅圈。',
    parameters: { type: 'object', additionalProperties: false, properties: { moment_id: { type: 'string', maxLength: 160 }, liked: { type: 'boolean' } }, required: ['moment_id', 'liked'] },
  },
};

export const DAILY_MODEL_TOOLS = Object.freeze([CREATE_MOMENT, CREATE_DIARY, MOMENT_COMMENT, MOMENT_LIKE]);
function callName(call = {}) { return String(call?.function?.name || call?.name || ''); }
function callArguments(call = {}) {
  const raw = call?.function?.arguments ?? call?.arguments ?? {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try { const parsed = JSON.parse(raw || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function trustedDefaults(context = {}) {
  const modelLabel = String(context.model_label || context.model || 'Coast API 模型伙伴').trim().slice(0, 180);
  return { author: 'api', source: 'chat_tool', conversation_id: context.conversation_id || null, source_turn_id: context.source_turn_id || null, tool_call_id: context.tool_call_id || null, identity: apiModelPartnerIdentity({ model_label: modelLabel || 'Coast API 模型伙伴' }) };
}
function preview(value, max = 180) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max)}…` : text; }
export function dailyWriteReceipt(recordType, record) {
  const type = recordType === 'diary' ? 'diary' : 'moment';
  return { kind: type, record_id: String(record?.id || ''), record_type: type, created_at: record?.created_at || new Date().toISOString(), where_to_find: type === 'diary' ? '小组件 > 日记' : '小组件 > 碳硅圈', text_preview: preview(record?.text), [type]: record };
}

export async function resolveMomentId(db, value = {}) {
  const raw = String(value.moment_id || value.target || '').trim();
  const normalized = raw.toLocaleLowerCase('zh-CN');
  if (LATEST_MOMENT_ALIASES.has(normalized)) {
    const [latest] = await listMoments(db, { status: 'published', limit: 1 });
    if (!latest?.id) throw new DailyStoreError('moment_not_found', '还没有可评论或点赞的碳硅圈动态。', 404);
    return latest.id;
  }
  if (!raw) throw new DailyStoreError('moment_target_required', '请指定要操作的碳硅圈动态。', 400);
  return raw;
}

export async function executeDailyModelTool(db, call, context = {}) {
  const name = callName(call); const input = callArguments(call); const trusted = trustedDefaults(context);
  if (name === 'create_moment') return dailyWriteReceipt('moment', await createMoment(db, input, trusted));
  if (name === 'create_diary') return dailyWriteReceipt('diary', await createDiary(db, { ...input, conflict_mode: input.conflict_mode || 'append' }, trusted));
  if (name === 'moment_comment') {
    const momentId = await resolveMomentId(db, input);
    return { kind: 'moment_comment', target_moment_id: momentId, moment: await addMomentComment(db, momentId, { text: input.text, author: 'api', model_id: trusted.identity.model_label }) };
  }
  if (name === 'moment_like') {
    const momentId = await resolveMomentId(db, input);
    return { kind: 'moment_like', target_moment_id: momentId, moment: await setMomentLike(db, momentId, input.liked !== false, 'api') };
  }
  const error = new Error(`Unsupported Daily tool: ${name}`); error.type = 'unknown_daily_tool'; throw error;
}
