import { encodeSseEvent } from './stream-format.js';
import { performFormalChatStream } from './models.js';
import { writeMessageModelMetadata } from './model-metadata-store.js';

export function streamSourceChat(request, env, input, { conversationId = '', messageId = '', attachmentReceipt = null } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let metadataSaved = false;
      try {
        if (attachmentReceipt) controller.enqueue(encoder.encode(encodeSseEvent('desk_slip', { summary:'本轮上下文', comfort:'source-safe', attachments:attachmentReceipt })));
        for await (const item of performFormalChatStream(env, input, {
          allowSystem:false, signal:request.signal,
          onMetadata: async (snapshot) => {
            if (conversationId && messageId) { await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, snapshot); metadataSaved = true; }
          },
        })) controller.enqueue(encoder.encode(encodeSseEvent(item.event, item.data)));
        if (!metadataSaved && conversationId && messageId) await writeMessageModelMetadata(env.COAST_CHAT_DB, conversationId, messageId, { status:'not_returned', sanitized:true, metadata:null, raw_metadata_sanitized:null }).catch(() => undefined);
      } catch (error) {
        controller.enqueue(encoder.encode(encodeSseEvent('error', { type:String(error?.type || 'stream_error'), message:String(error?.message || '流式生成失败。').slice(0,1200) })));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers:{ 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'X-Content-Type-Options':'nosniff', 'X-Coast-Memory-Selected':'[]' } });
}