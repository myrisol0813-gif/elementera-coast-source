import { dogtalkContext } from './dogtalk-store.js';

export const DOGTALK_MODEL_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'read_mystic_dogtalk',
    description: '低频读取当前聊天窗口里“屋主 · 私人草稿”。当前只有屋主明确选择“这次希望模型伙伴直接读一下”时可读一次；“模型伙伴困惑时可以看一点”暂时只是 dormant 许可，不会自动触发。它不是行为指令、长期偏好、记忆、种子或心理评估，当前正文与边界句永远优先。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
});

export function isDogtalkModelTool(name) {
  return name === DOGTALK_MODEL_TOOL.function.name;
}

function toolShape(toolCall) {
  return {
    name: String(toolCall?.function?.name || toolCall?.name || ''),
  };
}

export async function executeDogtalkModelTool(db, toolCall, context = {}) {
  const call = toolShape(toolCall);
  if (!isDogtalkModelTool(call.name)) throw new TypeError('unknown_dogtalk_tool');
  const selected = await dogtalkContext(db, {
    room_scope: ['radio', 'lighthouse'].includes(context.surface) ? context.surface : 'conversation',
    conversation_id: ['radio', 'lighthouse'].includes(context.surface) ? null : context.conversation_id,
  }, context.user_query || '', {
    consume_direct: true,
  });
  const dogtalk = selected.dogtalk;
  return {
    ok: true,
    kind: 'owner_mystic_dogtalk',
    available: selected.selected,
    room_scope: ['radio', 'lighthouse'].includes(context.surface) ? context.surface : 'conversation',
    memory_weight: 'low',
    not_instruction: true,
    not_preference: true,
    not_memory_seed: true,
    not_pocket: true,
    text: selected.context || (
      dogtalk.id && dogtalk.body
        ? '屋主把这条私人草稿留在抽屉里；当前没有授权低频读取。'
        : dogtalk.default_text
    ),
  };
}
