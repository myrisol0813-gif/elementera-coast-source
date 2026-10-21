package com.elementeracoast.app.feature.daily

import android.content.Context
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastHttpClient
import com.elementeracoast.app.core.network.coastErrorKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder

/**
 * Native counterpart of the Coast PWA calendar, voice and library frontends.
 * Same canonical API, same owner auth cookie, no independent local database.
 */
class SideRoomsRepository(private val config: CoastApiConfig, private val client: okhttp3.OkHttpClient) {
    private val json = Json { ignoreUnknownKeys = true }
    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    private fun path(value: String): String = encode(value)
    private val contentType = "application/json; charset=utf-8".toMediaType()

    private suspend fun request(path: String, method: String = "GET", payload: JsonElement? = null): JsonObject =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(config.url(path))
            when (method) {
                "POST" -> builder.post((payload ?: JsonObject(emptyMap())).toString().toRequestBody(contentType))
                "PATCH" -> builder.patch((payload ?: JsonObject(emptyMap())).toString().toRequestBody(contentType))
                "DELETE" -> builder.delete()
                else -> builder.get()
            }
            try {
                client.newCall(builder.build()).execute().use { response ->
                    val raw = response.body?.string().orEmpty()
                    val objectValue = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
                    if (!response.isSuccessful || objectValue?.get("ok")?.toString() == "false") {
                        val error = objectValue?.get("error") as? JsonObject
                        val type = error?.get("type")?.jsonPrimitive?.contentOrNull ?: "request_failed"
                        val message = error?.get("message")?.jsonPrimitive?.contentOrNull
                            ?: "海岸请求失败（${response.code}）。"
                        throw CoastApiException(coastErrorKind(response.code, type), type, message, response.code)
                    }
                    objectValue ?: throw CoastApiException(CoastApiErrorKind.Decode, "invalid_json", "海岸没有返回可读取的 JSON。")
                }
            } catch (error: CoastApiException) {
                throw error
            } catch (error: IOException) {
                throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "无法连接海岸后端。", cause = error)
            }
        }

    suspend fun calendar(month: String): JsonObject = request("/api/calendar/entries?month=${encode(month)}")
    suspend fun saveCalendar(id: String?, input: JsonObject): JsonObject =
        request(id?.let { "/api/calendar/entries/${path(it)}" } ?: "/api/calendar/entries",
            if (id == null) "POST" else "PATCH", input)
    suspend fun deleteCalendar(id: String) { request("/api/calendar/entries/${path(id)}", "DELETE") }


    suspend fun bookCover(id: String): ByteArray = withContext(Dispatchers.IO) {
        try {
            client.newCall(Request.Builder().url(config.url("/api/library/books/${path(id)}/cover"))
                .get().build()).execute().use { response ->
                if(!response.isSuccessful) throw CoastApiException(
                    coastErrorKind(response.code,"cover_unavailable"),"cover_unavailable",
                    "封面暂时无法读取。",response.code)
                val length=response.body?.contentLength() ?: -1L
                if(length>600*1024)throw IllegalArgumentException("封面超出 600 KB。")
                val bytes=response.body?.bytes() ?: ByteArray(0)
                if(bytes.isEmpty() || bytes.size>600*1024)throw IllegalArgumentException("封面无效或超出 600 KB。")
                bytes
            }
        } catch(error: CoastApiException) { throw error }
        catch(error: IOException) { throw CoastApiException(
            CoastApiErrorKind.Network,"cover_network_failed","无法读取海岸封面。",cause=error) }
    }
    suspend fun saveBookCover(id: String, jpeg: ByteArray) = withContext(Dispatchers.IO) {
        require(jpeg.isNotEmpty() && jpeg.size <= 600*1024) { "封面不能超过 600 KB。" }
        val url=config.url("/api/library/books/${path(id)}/cover")
        val request=Request.Builder().url(url).put(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
        try {
            client.newCall(request).execute().use { response ->
                val text=response.body?.string().orEmpty()
                val reply=runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                if(!response.isSuccessful || reply?.get("ok")?.toString()=="false") {
                    val error=reply?.get("error") as? JsonObject
                    val reason=error?.get("message")?.jsonPrimitive?.contentOrNull ?: "无法保存书籍封面。"
                    throw CoastApiException(coastErrorKind(response.code,"cover_failed"),"cover_failed",reason,response.code)
                }
            }
        }catch(error: CoastApiException) { throw error }
        catch(error: IOException) { throw CoastApiException(CoastApiErrorKind.Network,
            "cover_network_failed","封面没有传到海岸。",cause=error) }
    }

    suspend fun books(): JsonObject = request("/api/library/books")
    suspend fun book(id: String): JsonObject = request("/api/library/books/${path(id)}")
    // A bounded in-memory chapter cache; no disk copy of the user's private books.
    private val chapterCache = object : LinkedHashMap<String, JsonObject>(8, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, JsonObject>): Boolean =
            size > 5
    }

    suspend fun fullChapter(id: String, index: Int): JsonObject {
        val key="$id:$index"
        synchronized(chapterCache) { chapterCache[key] }?.let { return it }
        val response=request("/api/library/books/${path(id)}/chapters/$index/text")
        synchronized(chapterCache) { chapterCache[key]=response }
        return response
    }
    suspend fun chapter(id: String, index: Int, start: Int = 0): JsonObject =
        request("/api/library/books/${path(id)}/chapters/$index?start=$start&limit=12")
    suspend fun notes(id: String): JsonObject = request("/api/library/books/${path(id)}/notes")
    suspend fun importBook(payload: JsonObject, onProgress: (Int, Int) -> Unit = { _, _ -> }): JsonObject {
        val chapters = (payload["chapters"] as? kotlinx.serialization.json.JsonArray)?.map {
            it as? JsonObject ?: throw IllegalArgumentException("书籍章节格式错误。")
        } ?: throw IllegalArgumentException("书籍没有正文。")
        val total = chapters.sumOf { (it["body"]?.jsonPrimitive?.contentOrNull ?: "").trim().length }
        val metadata = kotlinx.serialization.json.buildJsonObject {
            put("title", payload["title"] ?: kotlinx.serialization.json.JsonPrimitive(""))
            put("format", payload["format"] ?: kotlinx.serialization.json.JsonPrimitive(""))
            put("chapters_count", kotlinx.serialization.json.JsonPrimitive(chapters.size))
            put("total_chars", kotlinx.serialization.json.JsonPrimitive(total))
        }
        val draft = request("/api/library/imports", "POST", metadata)
        val id = draft["import"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull
            ?: throw IllegalStateException("书房未返回导入编号。")
        try {
            var cursor = 0
            while (cursor < chapters.size) {
                val group = mutableListOf<JsonObject>()
                var chars = 0
                while (cursor + group.size < chapters.size && group.size < 8) {
                    val item = chapters[cursor + group.size]
                    val count = item["body"]?.jsonPrimitive?.contentOrNull.orEmpty().trim().length
                    if (count > 120000) throw IllegalArgumentException("章节超过单批上传上限。")
                    if (group.isNotEmpty() && chars + count > 120000) break
                    group.add(item)
                    chars += count
                }
                val next = kotlinx.serialization.json.buildJsonObject {
                    put("start_index", kotlinx.serialization.json.JsonPrimitive(cursor))
                    put("chapters", kotlinx.serialization.json.JsonArray(group))
                }
                val address = "/api/library/imports/${path(id)}/chapters"
                val uploaded = try { request(address, "POST", next) }
                    catch (error: Exception) {
                        // Idempotent repeat after a dropped connection; never send different data.
                        request(address, "POST", next)
                    }
                cursor = uploaded["progress"]?.jsonObject?.get("next_index")?.jsonPrimitive?.intOrNull
                    ?: throw IllegalStateException("分批上传没有返回保存位置。")
                onProgress(cursor, chapters.size)
            }
            return request("/api/library/imports/${path(id)}/finish", "POST")["book"]?.jsonObject
                ?: throw IllegalStateException("书房未确认整本书保存完成。")
        } catch (error: Exception) {
            try { request("/api/library/imports/${path(id)}", "DELETE") } catch (_: Exception) { }
            throw error
        }
    }
    suspend fun deleteBook(id: String) {
        request("/api/library/books/${path(id)}", "DELETE")
        synchronized(chapterCache) { chapterCache.keys.removeAll { it.startsWith("$id:") } }
    }
    suspend fun progress(id: String, index: Int, paragraph: Int) {
        request("/api/library/books/${path(id)}/progress", "POST",
            kotlinx.serialization.json.buildJsonObject { put("chapter_index", kotlinx.serialization.json.JsonPrimitive(index)); put("paragraph_index", kotlinx.serialization.json.JsonPrimitive(paragraph)) })
    }
    suspend fun writeNote(bookId: String, payload: JsonObject): JsonObject =
        request("/api/library/books/${path(bookId)}/notes", "POST", payload)
    suspend fun editNote(id: String, payload: JsonObject): JsonObject =
        request("/api/library/notes/${path(id)}", "PATCH", payload)
    suspend fun deleteNote(id: String) { request("/api/library/notes/${path(id)}", "DELETE") }

    suspend fun voiceClips(conversationId: String): JsonObject =
        request("/api/voice/clips?conversation_id=${encode(conversationId)}")
    suspend fun generateVoice(payload: JsonObject): JsonObject = request("/api/voice/clips", "POST", payload)
    suspend fun audio(id: String): ByteArray = withContext(Dispatchers.IO) {
        try {
            client.newCall(Request.Builder().url(config.url("/api/voice/clips/${path(id)}/audio")).get().build()).execute().use { response ->
                if (!response.isSuccessful) throw CoastApiException(coastErrorKind(response.code, "voice_unavailable"), "voice_unavailable", "这段声音暂时无法播放。", response.code)
                val bytes = response.body?.bytes() ?: ByteArray(0)
                if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) throw CoastApiException(CoastApiErrorKind.Decode, "voice_bytes_invalid", "语音文件不完整或超过 4 MB。")
                bytes
            }
        } catch (error: CoastApiException) { throw error }
        catch (error: IOException) { throw CoastApiException(CoastApiErrorKind.Network, "voice_network_failed", "无法连接海岸声音存储。", cause = error) }
    }

    companion object {
        fun production(context: Context): SideRoomsRepository {
            val app = context.applicationContext
            val config = CoastApiConfig.production()
            return SideRoomsRepository(config, CoastHttpClient(config, AndroidKeystoreAuthStore(app)).client)
        }
    }
}
