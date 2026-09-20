import { encodeSseEvent } from './stream-format.js';
import { performFormalChatStream } from './models.js';
import { writeMessageModelMetadata } from './model-metadata-store.js';

export function streamSourceChat(request, env, input, { conversationId = '', messageId = '', deskSlip = null, selectedMemoryIds = [], allowSystem = false } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let metadataSaved = false;
      let currentDeskSlip = deskSlip && typeof deskSlip === 'object' ? { ...deskSlip } : null;
      try {
        if (currentDeskSlip) controller.enqueue(encoder.encode(encodeSseEvent('desk_slip', currentDeskSlip)));
        for await (const item of performFormalChatStream(env, input, {
          allowSystem, signal:request.signal,
          onMetadata: async (snapshot) => {
            if (conversationId && messageId) { await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, snapshot); metadataSaved = true; }
          },
        })) {
          controller.enqueue(encoder.encode(encodeSseEvent(item.event, item.data)));
          if (item.event === 'server_tools' && item.data?.web_search) {
            currentDeskSlip = { ...(currentDeskSlip || {}), web_search:item.data.web_search };
            controller.enqueue(encoder.encode(encodeSseEvent('desk_slip', currentDeskSlip)));
          }
        }
        if (!metadataSaved && conversationId && messageId) await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, { status:'not_returned', sanitized:true, metadata:null, raw_metadata_sanitized:null }).catch(() => undefined);
      } catch (error) {
        controller.enqueue(encoder.encode(encodeSseEvent('error', { type:String(error?.type || 'stream_error'), message:String(error?.message || '流式生成失败。').slice(0,1200) })));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers:{ 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'X-Content-Type-Options':'nosniff', 'X-Coast-Memory-Selected':JSON.stringify((Array.isArray(selectedMemoryIds)?selectedMemoryIds:[]).map(String).slice(0,32)) } });
}