import { apiError, json } from '../http.js';
import { fetchModelCatalog } from './model-catalog.js';
import { ModelRequestError } from './model-validation.js';

export async function handleModels(request, env) {
  if (request.method !== 'GET') return apiError('method_not_allowed', 'Method not allowed.', 405);
  try {
    return json(await fetchModelCatalog(env, new URL(request.url).searchParams.get('refresh') === '1'));
  } catch (error) {
    return modelErrorResponse(error);
  }
}

export function modelErrorResponse(error) {
  if (error instanceof ModelRequestError) {
    return apiError(error.type, error.message, error.status, error.details);
  }
  const status = error?.status === 413 ? 413 : 400;
  return apiError(status === 413 ? 'body_too_large' : 'invalid_request', status === 413 ? '请求体过大。' : '请求体无效。', status);
}
