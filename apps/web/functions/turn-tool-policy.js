// The user controls the ordinary per-turn budget. This resource bound is separate
// from provider context limits and each side-effecting tool's own protections.
export const DEFAULT_TOOL_CALL_LIMIT=24;
export const RESOURCE_TOOL_CALL_LIMIT=128;
export function normalizeToolCallLimit(value) {
  if(value==null||value==='')return DEFAULT_TOOL_CALL_LIMIT;
  const n=Number(value);
  return Number.isSafeInteger(n)?Math.min(RESOURCE_TOOL_CALL_LIMIT,Math.max(1,n)):DEFAULT_TOOL_CALL_LIMIT;
}
