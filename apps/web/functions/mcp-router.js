import { apiError, json } from './http.js';
import { McpAuthError, MCP_SCOPES, mcpResourceMetadata } from './mcp-auth.js';
import {
  callCoastMcpTool,
  coastMcpInstructions,
  coastMcpVersion,
  listCoastMcpTools,
} from './mcp-tools.js';
import {
  THINKING_BLOCK_TOOL,
  THINKING_BLOCK_TOOL_NAME,
  callThinkingBlockTool,
  listThinkingBlockResources,
  readThinkingBlockResource,
} from './thinking-block-mcp.js';


const PUBLIC_PATHS = new Set([
  '/.well-known/oauth-protected-resource',
  '/mcp',
  '/mcp/health',
  '/mcp/manifest',
]);
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id, X-Coast-MCP-Catalog-Version',
    'X-Coast-MCP-Catalog-Version': coastMcpVersion,
    ...extra,
  };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function validRequest(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.jsonrpc === '2.0'
    && typeof value.method === 'string';
}

function protocolVersion(params) {
  const requested = String(params?.protocolVersion || '');
  return SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : null;
}

function listedTools() {
  return [...listCoastMcpTools(), THINKING_BLOCK_TOOL];
}

async function handleRpcMessage(message, request, env) {
  if (!validRequest(message)) return rpcError(message?.id, -32600, 'Invalid Request');
  const notification = message.id === undefined;
  if (notification) return null;
  if (message.method === 'initialize') {
    const version = protocolVersion(message.params);
    if (!version) {
      return rpcError(message.id, -32602, 'Unsupported protocolVersion', {
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      });
    }
    return rpcResult(message.id, {
      protocolVersion: version,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: {
        name: 'elementera-coast-porch',
        title: 'Elementera Coast MCP Porch',
        version: coastMcpVersion,
      },
      instructions: coastMcpInstructions,
    });
  }
  if (message.method === 'ping') return rpcResult(message.id, {});
  if (message.method === 'tools/list') {
    return rpcResult(message.id, { tools: listedTools() });
  }
  if (message.method === 'resources/list') {
    return rpcResult(message.id, { resources: listThinkingBlockResources() });
  }
  if (message.method === 'resources/read') {
    const uri = message.params?.uri;
    if (typeof uri !== 'string') return rpcError(message.id, -32602, 'Invalid resources/read parameters');
    const result = readThinkingBlockResource(uri);
    if (!result) return rpcError(message.id, -32602, 'Unknown resource URI');
    return rpcResult(message.id, result);
  }
  if (message.method === 'tools/call') {
    const params = message.params;
    if (!params || typeof params !== 'object' || Array.isArray(params) || typeof params.name !== 'string') {
      return rpcError(message.id, -32602, 'Invalid tools/call parameters');
    }
    const result = params.name === THINKING_BLOCK_TOOL_NAME
      ? await callThinkingBlockTool(params.arguments, request, env)
      : await callCoastMcpTool(
        params.name,
        params.arguments,
        request,
        env,
        params._meta || {},
      );
    return rpcResult(message.id, result);
  }
  return rpcError(message.id, -32601, 'Method not found');
}

async function handleMcpPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400, corsHeaders());
  }
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, 'Invalid Request'), 400, corsHeaders());
    const responses = (await Promise.all(body.map((message) => handleRpcMessage(message, request, env))))
      .filter(Boolean);
    if (!responses.length) return new Response(null, { status: 202, headers: corsHeaders() });
    return json(responses, 200, corsHeaders());
  }
  const response = await handleRpcMessage(body, request, env);
  if (!response) return new Response(null, { status: 202, headers: corsHeaders() });
  return json(response, 200, corsHeaders());
}

export function isMcpPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

export async function routeMcpRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (url.pathname === '/mcp/health') {
    if (request.method !== 'GET') return apiError('method_not_allowed', 'Method not allowed.', 405);
    return json({
      ok: true,
      service: 'elementera-coast-porch',
      version: coastMcpVersion,
      transport: 'streamable-http',
    }, 200, corsHeaders());
  }
  if (url.pathname === '/mcp/manifest') {
    if (request.method !== 'GET') return apiError('method_not_allowed', 'Method not allowed.', 405);
    const toolDefinitions = listedTools();
    return json({
      name: 'Elementera Coast MCP Porch',
      version: coastMcpVersion,
      tool_catalog_version: coastMcpVersion,
      endpoint: `${url.origin}/mcp`,
      authentication: 'oauth2',
      scopes: MCP_SCOPES,
      tools: toolDefinitions.map((tool) => tool.name),
      tool_count: toolDefinitions.length,
      tool_definitions: toolDefinitions,
      resources: listThinkingBlockResources(),
    }, 200, corsHeaders());
  }
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    if (request.method !== 'GET') return apiError('method_not_allowed', 'Method not allowed.', 405);
    try {
      return json(mcpResourceMetadata(request, env), 200, corsHeaders());
    } catch (error) {
      if (error instanceof McpAuthError) {
        return json({ type: error.type, message: error.message }, error.status, corsHeaders());
      }
      throw error;
    }
  }
  if (url.pathname !== '/mcp') return apiError('not_found', 'Not found.', 404);
  if (request.method === 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders({ Allow: 'POST' }),
    });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders({ Allow: 'POST' }),
    });
  }
  return handleMcpPost(request, env);
}
