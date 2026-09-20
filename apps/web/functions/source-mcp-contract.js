const TOOLS = Object.freeze([
  {
    name: 'source.external_message_send',
    description: 'Send a source-safe external message into a configured shared room.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['external','api_common_room','official_mcp'] },
        author: { type: 'string', maxLength: 120 },
        content: { type: 'string', minLength: 1, maxLength: 12000 },
        conversation_id: { type: 'string', maxLength: 180 },
        deliver_to_room: { type: 'boolean' },
      },
      required: ['channel','content'],
      additionalProperties: false,
    },
  },
  {
    name: 'source.external_message_list',
    description: 'List source external-entry messages already stored by this deployment.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['external','api_common_room','official_mcp'] },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
]);

export function sourceMcpContract() {
  return {
    name: 'Elementera Coast Source MCP Contract',
    version: '0.1',
    transport: 'adapter_defined',
    authentication: 'bring_your_own_adapter',
    public_endpoint: null,
    source_mode: true,
    room_mapping: { api_common_room: 'radio', official_mcp: 'lighthouse' },
    tools: TOOLS.map((tool) => ({ ...tool, input_schema: { ...tool.input_schema } })),
    notes: [
      'The source repository does not include production OAuth settings or a production remote endpoint.',
      'Connect your own authentication and transport adapter, then call the existing source external-entry service.',
      'Messages for api_common_room and official_mcp can be mirrored into the shared chat history.',
    ],
  };
}