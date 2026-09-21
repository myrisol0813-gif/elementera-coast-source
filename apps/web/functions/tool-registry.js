import {
  executeModelTool as executeCoreModelTool,
  executeRegisteredTool as executeCoreRegisteredTool,
  listRegisteredMcpTools as listCoreRegisteredMcpTools,
  listRegisteredTools as listCoreRegisteredTools,
  registeredMcpTool as coreRegisteredMcpTool,
  resolveToolSelection as resolveCoreToolSelection,
  ToolRegistryError,
} from './tool-registry-core.js';
import {
  DEV_HAND_TOOL_RECORDS,
  executeDevHandModelTool,
  isDevHandModelTool,
  resolveDevHandToolSelection,
} from './dev-hand-model-tools.js';
import { sendOfficialLighthouseMessage } from './room-conversation-service.js';
import { buildFurnitureSummary } from './tool-furniture-summary.js';

export { ToolRegistryError };

function withOfficialLighthouseReply(descriptor) {
  if (!descriptor || descriptor.tool_key !== 'lighthouse.write_letter') return descriptor;
  return {
    ...descriptor,
    description: '把官端 ChatGPT 来信写入最近一个或指定的 lighthouse conversation，并让海岸 API 模型伙伴 在同一 conversation 中即时回复。',
    invoked: '官端来信与海岸回复已经抵达',
  };
}

export function listRegisteredMcpTools() {
  return listCoreRegisteredMcpTools().map(withOfficialLighthouseReply);
}

export function registeredMcpTool(name) {
  return withOfficialLighthouseReply(coreRegisteredMcpTool(name));
}

export async function executeRegisteredTool(db, toolKey, input, context = {}) {
  if (toolKey === 'lighthouse.write_letter' && context.surface === 'official_mcp' && context.env) {
    return sendOfficialLighthouseMessage(context.env, {
      ...(input || {}),
      identity: input?.identity || context.identity,
    });
  }
  return executeCoreRegisteredTool(db, toolKey, input, context);
}

function devReceipt(record) {
  return {
    tool_key: record.tool_key,
    display_name: record.display_name,
    description: `屋主开发手 · ${record.tool_pack}`,
    scope: 'owner',
    owner_only: true,
    visitor_allowed: false,
    model_exposed: true,
    model_group: 'devhand',
    requires_confirmation: false,
    privacy_level: 'private',
    summary_policy: 'compact',
    auth_scopes: [],
    model_name: record.model_name,
    tool_pack: record.tool_pack,
    risk: record.risk,
    target_system: record.target_system,
  };
}

export function listRegisteredTools(context = {}) {
  const core = listCoreRegisteredTools(context);
  const dev = resolveDevHandToolSelection(context).records.map(devReceipt);
  return [...core, ...dev];
}

export function resolveToolSelection(context = {}) {
  const core = resolveCoreToolSelection(context);
  const dev = resolveDevHandToolSelection(context);
  return {
    backendTools: [...core.backendTools, ...dev.records.map(devReceipt)],
    modelVisibleToolRecords: [...core.modelVisibleToolRecords, ...dev.records],
    modelVisibleTools: [...core.modelVisibleTools, ...dev.tools],
  };
}

function devRunId(toolCall) {
  const supplied = String(toolCall?.id || '').trim();
  return supplied || crypto.randomUUID();
}

function devFurnitureDisplayName(record, fallback) {
  const name = record?.display_name || fallback;
  if (record?.risk === 'dangerous') return `高风险写入 · ${name}`;
  if (record?.risk === 'write') return `写入 · ${name}`;
  return name;
}

export async function executeModelTool(db, toolCall, context = {}) {
  const name = String(toolCall?.function?.name || toolCall?.name || '').trim();
  if (!isDevHandModelTool(name)) return executeCoreModelTool(db, toolCall, context);
  const record = DEV_HAND_TOOL_RECORDS.find((item) => item.model_name === name);
  const toolKey = record?.tool_key || `devhand.${name}`;
  const runId = devRunId(toolCall);
  const furnitureDisplayName = devFurnitureDisplayName(record, name);
  try {
    const result = await executeDevHandModelTool(context.env, db, toolCall, context);
    if (typeof context.on_tool_used === 'function') context.on_tool_used(furnitureDisplayName);
    if (typeof context.on_tool_run === 'function') context.on_tool_run(buildFurnitureSummary({
      id: runId,
      toolKey,
      displayName: furnitureDisplayName,
      status: 'success',
      output: result,
    }));
    return result;
  } catch (error) {
    if (typeof context.on_tool_run === 'function') context.on_tool_run(buildFurnitureSummary({
      id: runId,
      toolKey,
      displayName: furnitureDisplayName,
      status: 'error',
      error,
    }));
    throw error;
  }
}

export const DEV_HAND_MODEL_TOOL_RECORDS = DEV_HAND_TOOL_RECORDS;
