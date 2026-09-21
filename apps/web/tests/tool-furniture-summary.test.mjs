import assert from 'node:assert/strict';
import { buildFurnitureSummary, sanitizeFurnitureRuns } from '../functions/tool-furniture-summary.js';

const memoryOutput = {
  entries: Array.from({ length: 7 }, (_, index) => ({
    id: `memory-${index + 1}`,
    title: ['海鸟与岸', 'SSE 编解码统一', '不要虫子意象', '第四条', '第五条', '第六条', '第七条'][index],
    tag: ['关系', '工程技术', '偏好', '记录', '记录', '记录', '记录'][index],
    life_core: `绝不能进入家具摘要的正文-${index + 1}`,
    content: `PRIVATE_MEMORY_BODY_${index + 1}`,
  })),
  vector_enabled: true,
};
const memory = buildFurnitureSummary({
  id: 'run-memory',
  toolKey: 'memory.search',
  displayName: '搜索记忆',
  status: 'success',
  output: memoryOutput,
});
assert.equal(memory.label, '搜索了记忆');
assert.equal(memory.count, 7);
assert.equal(memory.items.length, 5);
assert.deepEqual(memory.items[0], { title: '海鸟与岸', kind: '关系' });
assert.deepEqual(memory.items[1], { title: 'SSE 编解码统一', kind: '工程技术' });
assert.equal(memory.extra_count, 2);
assert.equal(JSON.stringify(memory).includes('PRIVATE_MEMORY_BODY'), false);
assert.equal(JSON.stringify(memory).includes('绝不能进入家具摘要'), false);

const moment = buildFurnitureSummary({
  id: 'run-moment',
  toolKey: 'daily.create_moment',
  displayName: '发布动态',
  status: 'success',
  output: { text: '不应该进入消息 metadata 的碳硅圈全文', id: 'moment-1' },
});
assert.equal(moment.label, '写了一条碳硅圈');
assert.equal(JSON.stringify(moment).includes('碳硅圈全文'), false);

const diary = buildFurnitureSummary({
  id: 'run-diary',
  toolKey: 'daily.create_diary',
  displayName: '写日记',
  status: 'success',
  output: { text: 'PRIVATE_DIARY_BODY' },
});
assert.equal(diary.label, '写了一篇日记');
assert.equal(JSON.stringify(diary).includes('PRIVATE_DIARY_BODY'), false);

const dogtalk = buildFurnitureSummary({
  id: 'run-dogtalk',
  toolKey: 'dogtalk.read',
  displayName: '读取人类思考链',
  status: 'success',
  output: { body: '完整人类思考链绝不能显示', true_core: 'PRIVATE_DOGTALK_CORE', status: 'active' },
});
assert.equal(dogtalk.label, '读取了人类思考链');
assert.equal(JSON.stringify(dogtalk).includes('完整人类思考链'), false);
assert.equal(JSON.stringify(dogtalk).includes('PRIVATE_DOGTALK_CORE'), false);

const mailbox = buildFurnitureSummary({
  id: 'run-mailbox',
  toolKey: 'mailbox.fetch_unreplied',
  displayName: '巡看访客信箱',
  status: 'success',
  output: { visitor_count: 2, visitor_body: 'PRIVATE_VISITOR_BODY' },
});
assert.equal(mailbox.label, '巡看访客信箱');
assert.equal(JSON.stringify(mailbox).includes('PRIVATE_VISITOR_BODY'), false);

const candidate = buildFurnitureSummary({
  id: 'run-pocket',
  toolKey: 'memory.write_candidate',
  displayName: '写入待确认区',
  status: 'success',
  output: { title: '一枚候选标题', content: 'PRIVATE_CANDIDATE_BODY' },
});
assert.equal(candidate.label, '放入待确认区');
assert.deepEqual(candidate.items, [{ title: '一枚候选标题', kind: '待确认' }]);
assert.equal(JSON.stringify(candidate).includes('PRIVATE_CANDIDATE_BODY'), false);

const excerptCandidate = buildFurnitureSummary({
  id: 'run-global-excerpt',
  toolKey: 'memory.global_excerpt_propose',
  displayName: '改动待确认的全局摘录',
  status: 'success',
  output: { candidate_id: 'candidate-1', proposed_body: 'PRIVATE_GLOBAL_EXCERPT_BODY' },
});
assert.equal(excerptCandidate.label, '全局摘录：新增 1 条待确认修改');
assert.deepEqual(excerptCandidate.items, [{ title: '待确认的全局摘录修改', kind: '全局摘录' }]);
assert.equal(JSON.stringify(excerptCandidate).includes('PRIVATE_GLOBAL_EXCERPT_BODY'), false);

const failure = buildFurnitureSummary({
  id: 'run-error',
  toolKey: 'daily.create_moment',
  displayName: '发布动态',
  status: 'error',
  error: { type: 'daily_write_failed', message: 'SECRET_UPSTREAM_MESSAGE' },
});
assert.equal(failure.label, '某个工具没有正常完成');
assert.equal(failure.error_type, 'daily_write_failed');
assert.equal(JSON.stringify(failure).includes('SECRET_UPSTREAM_MESSAGE'), false);

const sanitized = sanitizeFurnitureRuns([{ ...memory, items: [...memory.items, { title: '第六条', kind: '记录' }] }]);
assert.equal(sanitized[0].items.length, 5);
assert.equal(sanitized[0].extra_count, 2);

console.log('tool-furniture-summary: ok');
