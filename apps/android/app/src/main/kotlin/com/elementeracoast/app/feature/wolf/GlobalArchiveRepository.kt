package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.network.CoastApiClient
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.*
import com.elementeracoast.app.BuildConfig
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

interface GlobalArchiveRepository {
    suspend fun snapshot(): JsonElement
    suspend fun fullArchive(): JsonElement = error("完整包导出未接入。")
    suspend fun transferExport(): JsonObject = error("迁移导出未接入。")
    suspend fun transferPreview(bundle: JsonObject, modules: Set<String>): JsonObject = error("迁移预览未接入。")
    suspend fun transferImport(bundle: JsonObject, modules: Set<String>): JsonObject = error("迁移导入未接入。")
}

class DefaultGlobalArchiveRepository(
    private val api: CoastApiClient
) : GlobalArchiveRepository {
    internal fun archiveV2(context: android.content.Context, local: Boolean) = ArchiveV2Operations(api,context,local)
    override suspend fun snapshot(): JsonElement = api.getGlobalSnapshot()
    override suspend fun fullArchive(): JsonElement = api.getFullArchive()
    override suspend fun transferExport(): JsonObject = api.transferExport()
    override suspend fun transferPreview(bundle: JsonObject, modules: Set<String>): JsonObject = api.transferPreview(bundle, modules)
    override suspend fun transferImport(bundle: JsonObject, modules: Set<String>): JsonObject = api.transferImport(bundle, modules)
}

object GlobalArchive {
    private val prettyJson = Json { prettyPrint = true }

    fun exportJson(snapshot: JsonElement): String =
        prettyJson.encodeToString(JsonElement.serializer(), snapshot)

    /** Same completeness checks as the Web full archive; do not advertise a partial file as recoverable. */
    fun auditFullArchive(archive: JsonElement): List<String> = buildList {
        val root = archive as? JsonObject ?: run { add("完整包不是对象"); return@buildList }
        fun JsonObject.obj(k: String) = this[k] as? JsonObject
        fun JsonObject.arr(k: String) = this[k] as? JsonArray
        fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
        fun JsonObject.yes(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull == true
        if (root.str("format") != "elementera-coast-full-archive" || root.str("version") != "1") add("文件格式或版本不符合完整海岸包约定")
        if (root.obj("chat")?.arr("conversations") == null) add("缺少完整聊天窗口目录")
        val vault = root.obj("coast_vault")
        if (vault?.obj("basic_media")?.yes("complete") != true || vault?.obj("treasures")?.yes("complete") != true)
            add("基本文件库或拾潮索引缺失或存在未导出的分页")
        val attachment = root.obj("attachments")
        val count = attachment?.str("count")?.toIntOrNull() ?: 0
        val payloads = attachment?.arr("payloads")
        if (count > 0 && payloads == null) add("附件原件清单缺失")
        else if (payloads != null) {
            val unavailable = payloads.count { (it as? JsonObject)?.yes("unavailable") == true }
            val omitted = (count - payloads.size).coerceAtLeast(0)
            if (unavailable + omitted > 0) add("附件原件缺失 " + (unavailable + omitted) + " 项")
        }
        val voice = root.obj("voice")
        val voiceCount = voice?.arr("clips")?.size ?: 0
        if (voiceCount > (voice?.arr("payloads")?.size ?: 0)) add("已存语音原件数量与索引不一致")
    }

    fun withNativeSettings(snapshot: JsonElement, state: WolfState?, localMode: Boolean): JsonElement {
        val root = snapshot as? JsonObject ?: return snapshot
        val device = buildJsonObject {
            put("exported_from", "native")
            put("workspace", if (localMode) "local" else "backend")
            put("current_app_version", BuildConfig.VERSION_NAME)
            if (state != null) {
                put("display_profile", buildJsonObject { put("nickname", state.profile.nickname); put("signature", state.profile.signature) })
                put("appearance", buildJsonObject {
                    put("theme", state.appearance.theme.name)
                    put("user_bubble_hex", state.appearance.userBubbleHex)
                    put("accent_hex", state.appearance.accentHex)
                    put("font_mode", state.appearance.fontMode.name)
                    put("paper_mode", state.appearance.paperMode.name)
                    put("reading_weight", state.appearance.readingWeight.name)
                    put("cloud_outline_enabled", state.appearance.cloudOutlineEnabled)
                    put("message_surface_alpha", state.appearance.messageSurfaceAlpha)
                    put("chat_background_dim_alpha", state.appearance.chatBackgroundDimAlpha)
                })
                put("basic_settings", buildJsonObject {
                    put("recentTurns", state.basic.recentTurns); put("contextBudget", state.basic.contextBudget)
                    put("outputLength", state.basic.outputLength); put("maxOutputTokens", state.basic.maxOutputTokens)
                    put("creativity", state.basic.creativity); put("streamingEnabled", state.basic.streamingEnabled)
                    put("soilBudget", state.basic.soilBudget); put("seedCooldownTurns", state.basic.seedCooldownTurns)
                    put("worldbookEnabled", state.basic.worldbookEnabled); put("worldbookLimit", state.basic.worldbookLimit)
                    put("memoryLimit", state.basic.memoryLimit)
                })
            }
        }
        return buildJsonObject {
            root.forEach { (key, value) -> put(key, value) }
            put("local_device", device)
            put("included_modules", JsonArray(((root["included_modules"] as? JsonArray).orEmpty() +
                JsonPrimitive("native_device_settings")).distinct()))
            put("excluded_modules", JsonArray(((root["excluded_modules"] as? JsonArray).orEmpty() +
                listOf("native_background_and_font_binary", "local_provider_credentials", "oauth_credentials").map(::JsonPrimitive)).distinct()))
        }
    }

    fun exportHtml(snapshot: JsonElement): String {
        val root = snapshot.runCatching { jsonObject }.getOrNull()
            ?: return basicHtml("Elementera Coast 全局快照", "快照格式无法展开。", exportJson(snapshot))

        val titles = mapOf(
            "chat" to "聊天窗口 · 主聊天 / 共通聊天室 / MCP 对话区",
            "thinking_soil" to "整理当前对话的纸条",
            "memory" to "记忆系统 · 全局摘录 · 自定义指令",
            "worldbook" to "世界书",
            "dogtalk" to "私人草稿 / 跨窗口相关数据",
            "mailbox" to "访客信箱 / 来信（隐私摘要）",
            "daily" to "日常 / 日记",
            "calendar" to "日历与日程",
            "voice" to "语音索引",
            "coast_vault" to "文件库与拾潮",
            "tidal_library" to "书房与批注",
            "local_device" to "本机设置",
            "model_profile" to "模型资料",
            "model_echo_summaries" to "模型后端返回原文摘要",
            "tools" to "工具设置与日志摘要",
            "attachments" to "附件索引与元数据",
            "web_search" to "网络搜索摘要",
            "update_records" to "更新记录",
            "versions" to "版本信息",
            "included_modules" to "已包含模块",
            "excluded_modules" to "未包含模块与安全说明",
            "redaction" to "脱敏说明",
            "integrations" to "集成元数据"
        )
        val preferred = listOf(
            "chat", "thinking_soil", "memory", "worldbook", "dogtalk", "mailbox", "daily",
            "model_profile", "model_echo_summaries", "tools", "attachments", "web_search",
            "update_records", "versions", "integrations", "included_modules", "excluded_modules", "redaction"
        )
        val keys = (preferred + root.keys.filterNot { it in preferred }).distinct().filter { it in root }
        val exportedAt = root["exported_at"]?.let { element ->
            runCatching { element.jsonPrimitive.content }.getOrNull()
        }.orEmpty()
        val sections = keys.joinToString("\n") { key ->
            val value = root[key] ?: return@joinToString ""
            """<section><h2>${html(titles[key] ?: key)}</h2><pre>${html(prettyJson.encodeToString(JsonElement.serializer(), value))}</pre></section>"""
        }

        return """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elementera Coast 全局 HTML 导出</title>
<style>
:root{color-scheme:light;--paper:#fffdf8;--ink:#2d3036;--muted:#7d7a75;--line:#e8e0d3;--wash:#f6f8fb}
*{box-sizing:border-box}
body{margin:0;background:var(--wash);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}
main{width:min(100% - 24px,980px);margin:0 auto;padding:28px 0 50px}
header,section{background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:20px;margin:0 0 14px;box-shadow:0 8px 28px rgba(56,49,39,.045)}
h1{font-size:24px;margin:0 0 6px}h2{font-size:17px;margin:0 0 12px}
p{margin:4px 0;color:var(--muted)}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12.5px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
.note{font-size:13px}
</style>
</head>
<body><main>
<header>
<h1>Elementera Coast · 全局快照</h1>
<p>${html(exportedAt)}</p>
<p class="note">JSON 与 HTML 都来自 /api/export/v1-snapshot。同一快照包含主要可读数据；附件只列索引与元数据，不嵌入二进制本体。</p>
</header>
$sections
</main></body></html>"""
    }

    private fun basicHtml(title: String, note: String, body: String): String =
        """<!doctype html><meta charset="utf-8"><title>${html(title)}</title><body><h1>${html(title)}</h1><p>${html(note)}</p><pre>${html(body)}</pre></body>"""

    private fun html(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}
