import { escapeHtml } from '../../core/dom.js';
import { memoryDate } from './memory-format.js';

export function customInstructionsBody(instructionsValue) {
  const instructions = instructionsValue || {
    content: '', status: 'active', updated_at: null, updated_by: 'xiaohan', source: '屋主手动编辑',
  };
  return `<form class="form-stack memory-custom-instructions" data-submit="memory:custom-instructions-save">
    <label>当前自定义指令<textarea name="content" rows="16" maxlength="32000">${escapeHtml(instructions.content)}</textarea></label>
    <p class="feature-note">状态：active · 来源：${escapeHtml(instructions.source || '屋主手动编辑')}${instructions.updated_at ? ` · 更新：${escapeHtml(memoryDate(instructions.updated_at))}` : ''}</p>
    <button class="primary-wide" type="submit">保存当前指令</button>
  </form>`;
}
