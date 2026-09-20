import { fetchModelCatalog } from './model-catalog.js';
import { catalogModel, supportsTools } from './model-validation.js';

export async function modelToolSupport(env, modelId) {
  const catalog = await fetchModelCatalog(env);
  const id = String(modelId || catalog.defaults?.chat || '').trim();
  const model = catalogModel(catalog, id);
  if (!model) return { model: id || null, supported: false, reason: 'model_not_in_catalog' };
  const supported = supportsTools(id, model);
  return {
    model: id,
    supported,
    reason: supported ? 'supported' : 'provider_model_does_not_advertise_tools',
    supported_parameters: Array.isArray(model.supported_parameters) ? model.supported_parameters.filter((item) => ['tools', 'tool_choice'].includes(item)) : [],
  };
}
