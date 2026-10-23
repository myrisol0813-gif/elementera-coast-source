import { json, methodNotAllowed } from '../http.js';
import { MemoryStoreError, readSoil, writeSoil } from '../memory-store.js';
import { decorateSoilProvenance } from '../provenance-store.js';
import { body, conversationIdFrom } from './memory-request.js';
import { organizeConversationSoil } from './memory-soil-organizer.js';

export async function routeSoil(request, env, url) {
  const conversationId = conversationIdFrom(url);
  if (request.method === 'GET') {
    const value = await readSoil(env.COAST_CHAT_DB, conversationId);
    return json({ ok: true, soil: await decorateSoilProvenance(env.COAST_CHAT_DB, value) });
  }
  if (request.method === 'PUT') {
    const value = await body(request);
    const written = await writeSoil(env.COAST_CHAT_DB, conversationId, value);
    return json({ ok: true, soil: await decorateSoilProvenance(env.COAST_CHAT_DB, written) });
  }
  return methodNotAllowed('GET, PUT');
}

export async function routeSoilOrganize(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const value = await body(request);
  const conversationId = conversationIdFrom(new URL(request.url), value);
  if (value.plan_phase || String(value.model || '').startsWith('chatgpt-plan:')) {
    throw new MemoryStoreError(
      'plan_soil_requires_native',
      'ChatGPT 套餐轮次的当前对话纸条须通过本机套餐整理接口。',
      409,
    );
  }
  return json(await organizeConversationSoil(env, conversationId, value));
}

export async function routeNativePlanSoil(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const value = await body(request);
  const conversationId = conversationIdFrom(new URL(request.url), value);
  const planPhase = String(value.action || '');
  if (!['prepare', 'commit'].includes(planPhase)) {
    throw new MemoryStoreError('invalid_plan_phase', '只支持准备或提交本机当前对话纸条。', 400);
  }
  return json(await organizeConversationSoil(env, conversationId, {
    ...value,
    trigger: 'reply',
    plan_phase: planPhase,
  }));
}
