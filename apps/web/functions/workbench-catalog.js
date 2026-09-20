import { integrationCatalog } from './source-integrations.js';

export function workbenchToolCatalog() {
  const integrationTools = integrationCatalog().flatMap((adapter) =>
    adapter.capabilities.map((capability) => ({
      key: `${adapter.id}.${capability}`,
      category: adapter.id,
      display_name: `${adapter.label} · ${capability.replaceAll('_', ' ')}`,
      available: false,
      source_mode: true,
      requires_adapter: true,
    })));
  return [
    {
      key: 'workbench.self_check',
      category: 'system',
      display_name: '开发手自检',
      available: true,
      source_mode: true,
      requires_adapter: false,
    },
    {
      key: 'workbench.tool_runs',
      category: 'system',
      display_name: '工具调用记录',
      available: true,
      source_mode: true,
      requires_adapter: false,
    },
    ...integrationTools,
  ];
}
