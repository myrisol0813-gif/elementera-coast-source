export const DEFAULT_FREE = Object.freeze([
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
]);

export const SERIES = Object.freeze([
  { key: 'o', title: 'o 系列' },
  { key: '4', title: 'GPT-4 系列' },
  { key: '5', title: 'GPT-5 系列' },
  { key: 'other', title: '其他 OpenAI Chat' },
]);

export const HANDLER_NAMES = Object.freeze({
  click: 'handleAction',
  submit: 'handleSubmit',
  input: 'handleInput',
  change: 'handleChange',
});
