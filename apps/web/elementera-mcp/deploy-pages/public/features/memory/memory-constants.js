export const MEMORY_ROUTES = new Set([
  'thought-soil',
  'thought-soil-edit',
  'memory-pockets',
  'memory',
  'memory-entry-edit',
  'memory-vector-status',
  'global-excerpt',
  'global-excerpt-edit',
]);

export const MEMORY_TAGS = Object.freeze([
  '关系',
  '历史锚点',
  '偏好',
  '人物档案',
  '世界观',
  '工程技术',
]);

export const MEMORY_FILTER_KINDS = Object.freeze({
  tag: Object.freeze({ label: '标签', stateKey: 'tag', param: 'tag', facetKey: null, allLabel: '全部标签', emptyLabel: '' }),
  time: Object.freeze({ label: '日期', stateKey: 'sourceTime', param: 'source_time', facetKey: 'times', allLabel: '全部日期', emptyLabel: '暂无日期' }),
  model: Object.freeze({ label: '模型', stateKey: 'sourceModel', param: 'source_model', facetKey: 'models', allLabel: '全部模型', emptyLabel: '暂无模型' }),
  window: Object.freeze({ label: '窗口', stateKey: 'sourceWindow', param: 'source_window', facetKey: 'windows', allLabel: '全部窗口', emptyLabel: '暂无窗口' }),
});

export const MEMORY_FILTER_KIND_ORDER = Object.freeze(['time', 'model', 'window', 'tag']);
