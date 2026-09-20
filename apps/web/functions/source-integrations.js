const ADAPTERS = Object.freeze({
  github: {
    id: 'github',
    label: 'GitHub',
    description: 'Source mode provides the integration contract only. Connect your own GitHub adapter to enable repository actions.',
    capabilities: ['repository_read', 'code_search', 'commit_history', 'optional_write_actions'],
  },
  notion: {
    id: 'notion',
    label: 'Notion',
    description: 'Source mode provides the integration contract only. Connect your own Notion adapter to enable page actions.',
    capabilities: ['page_read', 'optional_page_write'],
  },
});

export function integrationCatalog() {
  return Object.values(ADAPTERS).map((item) => ({ ...item, capabilities: [...item.capabilities] }));
}

export function integrationSelfCheck(id) {
  const adapter = ADAPTERS[id];
  if (!adapter) return { id, available: false, configured: false, reason: 'unknown_adapter' };
  return {
    id: adapter.id,
    label: adapter.label,
    available: false,
    configured: false,
    mode: 'source_adapter_required',
    reason: 'adapter_not_connected',
    capabilities: [...adapter.capabilities],
  };
}
