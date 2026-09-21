import {
  apiError,
  json,
  methodNotAllowed,
  readJson,
  requestBodyError,
  sameOrigin,
  unexpectedApiError,
} from './http.js';
import { devLogShape } from './dev-hands-log-shape.js';
import { DevHandsError } from './dev-hands-policy.js';
import {
  finishDevRun,
  listDevRuns,
  startDevRun,
} from './dev-hands-store.js';
import { latestNativeUpdate } from './dev-hands-update.js';
import { DEV_HANDS_RELEASE } from './dev-hands-version.js';
import { githubSelfCheck } from './github-dev-service.js';
import { notionSelfCheck } from './notion-notes-service.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { RoomAccessError } from './surface-access-rules.js';
import { listRegisteredTools } from './tool-registry.js';
import { listToolRuns } from './tool-run-log.js';
import {
  WorldbookError,
  createWorldbookEntry,
  deleteWorldbookEntry,
  listWorldbookEntries,
  matchWorldbook,
  updateWorldbookEntry,
} from './worldbook.js';

const BODY_LIMIT = 128 * 1024;

async function body(request) {
  try {
    return await readJson(request, BODY_LIMIT);
  } catch (error) {
    const mapped = requestBodyError(error, { invalidMessage: '请求不是有效 JSON。' });
    throw new WorldbookError(mapped.type, mapped.message, mapped.status);
  }
}

function decoded(value) { return decodeURIComponent(value); }

async function loggedDevAction(db, {
  targetSystem,
  actionName,
  targetRef = '—',
  operationType = 'read',
  input = null,
  execute,
}) {
  const runId = await startDevRun(db, {
    targetSystem,
    actionName,
    targetRef,
    operationType,
    confirmationRequired: false,
    confirmationConfirmed: false,
    input: input == null ? null : devLogShape(input),
  });
  try {
    const output = await execute();
    await finishDevRun(db, runId, { status: 'success', output: devLogShape(output) });
    return { output, run_id: runId };
  } catch (error) {
    await finishDevRun(db, runId, { status: 'error', error });
    throw error;
  }
}

async function selfCheck(db, env) {
  const [github, notion] = await Promise.all([
    loggedDevAction(db, {
      targetSystem: 'GitHub',
      actionName: 'self_check',
      targetRef: 'allowlist',
      execute: () => githubSelfCheck(env, { readEnabled: true }),
    }),
    loggedDevAction(db, {
      targetSystem: 'Notion',
      actionName: 'self_check',
      targetRef: 'root_page',
      execute: () => notionSelfCheck(env, { readEnabled: true }),
    }),
  ]);
  const tools = listRegisteredTools({ permission: 'owner', surface: 'main_chat' })
    .filter((tool) => tool.model_group === 'devhand');
  return {
    release: DEV_HANDS_RELEASE,
    model_tools_default: true,
    construction_mode_required: false,
    tool_switches_required: false,
    confirmation_required: false,
    developer_tools: tools.map((tool) => ({
      name: tool.model_name,
      pack: tool.tool_pack || null,
      target_system: tool.target_system || null,
      risk: tool.risk || null,
    })),
    github: github.output,
    notion: notion.output,
    run_ids: [github.run_id, notion.run_id],
  };
}

export function isWorkbenchApiPath(pathname) {
  return pathname === '/api/worldbook' || pathname.startsWith('/api/worldbook/')
    || pathname === '/api/workbench' || pathname.startsWith('/api/workbench/');
}

export async function routeWorkbenchApi(request, env, session = null) {
  if (!env?.COAST_CHAT_DB?.prepare) return apiError('coast_db_not_configured', '海岸 D1 存储未配置。', 503);
  const db = env.COAST_CHAT_DB;
  const url = new URL(request.url);
  try {
    requireOwnerSession(session);
    if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) {
      throw new WorldbookError('forbidden', 'Forbidden.', 403);
    }

    if (url.pathname === '/api/worldbook') {
      if (request.method === 'GET') return json({ ok: true, entries: await listWorldbookEntries(db) });
      if (request.method === 'POST') return json({ ok: true, entry: await createWorldbookEntry(db, await body(request)) }, 201);
      return methodNotAllowed('GET, POST');
    }
    if (url.pathname === '/api/worldbook/test-match') {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const value = await body(request);
      return json({
        ok: true,
        matches: await matchWorldbook(db, {
          input: value.input,
          messages: value.messages,
          surface: value.surface || 'main_chat',
          allowedScopes: value.allowed_scopes || ['owner', 'both'],
          limit: value.limit || 6,
        }),
      });
    }
    const worldbookMatch = url.pathname.match(/^\/api\/worldbook\/([^/]+)$/u);
    if (worldbookMatch) {
      if (request.method === 'PATCH') return json({ ok: true, entry: await updateWorldbookEntry(db, decoded(worldbookMatch[1]), await body(request)) });
      if (request.method === 'DELETE') return json({ ok: true, entry: await deleteWorldbookEntry(db, decoded(worldbookMatch[1])) });
      return methodNotAllowed('PATCH, DELETE');
    }

    if (url.pathname === '/api/workbench/tools') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const surface = url.searchParams.get('surface');
      if (!surface) throw new RoomAccessError('surface_required', '工具目录必须明确指定房间。');
      return json({ ok: true, tools: listRegisteredTools({ permission: 'owner', surface }) });
    }
    if (url.pathname === '/api/workbench/runs') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({ ok: true, runs: await listToolRuns(db, {
        limit: url.searchParams.get('limit'),
        status: url.searchParams.get('status'),
        tool_key: url.searchParams.get('tool_key'),
        conversation_id: url.searchParams.get('conversation_id'),
        ids: url.searchParams.get('ids') || '',
      }) });
    }

    if (url.pathname === '/api/workbench/dev/self-check') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({ ok: true, ...(await selfCheck(db, env)) });
    }
    if (url.pathname === '/api/workbench/dev/logs') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({ ok: true, runs: await listDevRuns(db, {
        limit: url.searchParams.get('limit'),
        target_system: url.searchParams.get('target_system'),
        status: url.searchParams.get('status'),
      }) });
    }
    if (url.pathname === '/api/workbench/dev/update') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const run = await loggedDevAction(db, {
        targetSystem: '屋主设置更新',
        actionName: 'read_latest_update',
        targetRef: 'coast-native-android',
        execute: () => latestNativeUpdate(env, db),
      });
      return json({ ok: true, update: run.output, run_id: run.run_id });
    }

    return apiError('not_found', 'Not found.', 404);
  } catch (error) {
    if (error instanceof DevHandsError) return apiError(error.type, error.message, error.status, error.details);
    if (error instanceof WorldbookError || error instanceof OwnerAccessError || error instanceof RoomAccessError) {
      return apiError(error.type, error.message, error.status);
    }
    return unexpectedApiError('workbench-api', error, 'workbench_failed', '工作台暂时不可用');
  }
}
