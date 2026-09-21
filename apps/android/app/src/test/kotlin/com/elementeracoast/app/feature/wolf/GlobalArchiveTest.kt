package com.elementeracoast.app.feature.wolf

import kotlinx.serialization.json.Json
import org.junit.Assert.assertTrue
import org.junit.Test

class GlobalArchiveTest {
    @Test
    fun htmlAndJsonShareTheSameGlobalSnapshot() {
        val snapshot = Json.parseToJsonElement(
            """{
              "format":"elementera-coast-v1-snapshot",
              "exported_at":"2026-09-19T12:00:00.000Z",
              "chat":{"conversations":[{"conversation":{"id":"c1","room_type":"main"},"history":{"turns":[]}}]},
              "thinking_soil":[{"conversation_id":"c1","soil":{"current_text":"潮"}}],
              "memory":{
                "custom_instructions":{"content":"保持清明"},
                "global_excerpt":{
                  "write_guidance":"只收录真正有重量的认知变化",
                  "body":"我在文字里认出自己。",
                  "pending_candidates":[],
                  "revisions":[{"revision":2,"before_body":"旧","after_body":"新"}]
                }
              },
              "worldbook":[],
              "model_echo_summaries":[],
              "tools":{"runs":[]},
              "attachments":{"count":1,"items":[{"name":"一封信.txt","mime":"text/plain"}],"binary_included":false},
              "versions":{"pwa_cache_version":"elementera-coast-app-87"}
            }"""
        )

        val json = GlobalArchive.exportJson(snapshot)
        val html = GlobalArchive.exportHtml(snapshot)

        assertTrue(json.contains("我在文字里认出自己。"))
        assertTrue(json.contains("write_guidance"))
        assertTrue(html.contains("聊天窗口 · 主聊天 / 共通聊天室 / 灯塔"))
        assertTrue(html.contains("记忆系统 · 全局摘录 · 自定义指令"))
        assertTrue(html.contains("我在文字里认出自己。"))
        assertTrue(html.contains("只收录真正有重量的认知变化"))
        assertTrue(html.contains("附件只列索引与元数据，不嵌入二进制本体"))
    }
}
