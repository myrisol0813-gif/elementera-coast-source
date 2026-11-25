package com.elementeracoast.app.feature.wolf

import kotlinx.serialization.json.*
import java.io.OutputStream
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Read-only ZIP. Generated paths only; all message text escaped. */
internal object OfflineHtmlArchive {
    private fun JsonElement?.obj() = this as? JsonObject ?: JsonObject(emptyMap())
    private fun JsonElement?.arr() = this as? JsonArray ?: JsonArray(emptyList())
    private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    private fun esc(s: String) = s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;")
    private val extensions = mapOf("image/png" to "png","image/jpeg" to "jpg","image/gif" to "gif","image/webp" to "webp",
        "audio/mpeg" to "mp3","audio/wav" to "wav","audio/ogg" to "ogg","audio/mp4" to "m4a","video/mp4" to "mp4","application/pdf" to "pdf","text/plain" to "txt")
    private val style = "body{font:16px/1.7 system-ui,sans-serif;background:#f5f5f2;color:#344554;margin:0}main{max-width:920px;margin:auto;padding:24px 16px}section,article{background:#fffdf9;padding:16px;border-radius:18px;margin:12px 0}article.user{background:#eaf1f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace}img,video,audio{display:block;max-width:100%;margin:8px 0}a{color:#365e7d}small{color:#667984}summary{cursor:pointer}"
    private fun page(title: String, body: String) = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: file:; media-src 'self' file:"><title>"""+esc(title)+"""</title><style>$style</style></head><body><main>$body</main></body></html>"""
    private fun mediaHtml(m: JsonObject,prefix: String = ""): String {
        val url = esc(prefix+m.str("path")); val name = esc(m.str("name")); val mime = m.str("mime")
        return """<a href="$url" download>$name</a>""" + when (mime) {
            "image/png","image/jpeg","image/gif","image/webp" -> """<img loading="lazy" src="$url" alt="$name">"""
            "audio/mpeg","audio/wav","audio/ogg","audio/mp4" -> """<audio controls preload="none" src="$url"></audio>"""
            "video/mp4" -> """<video controls preload="none" src="$url"></video>"""
            else -> ""
        }
    }
    fun write(archive: JsonElement, output: OutputStream, initialWarnings: List<String> = emptyList()): List<String> {
        val root = archive.obj()
        val warnings = initialWarnings.toMutableList()
        val media = mutableListOf<JsonObject>()
        val attachments = mutableMapOf<String,JsonObject>()
        val nav = mutableListOf<String>(); val sections = mutableListOf<String>()
        ZipOutputStream(output).use { zip ->
            fun entry(name: String, body: ByteArray) { zip.putNextEntry(ZipEntry(name)); zip.write(body); zip.closeEntry() }
            fun text(name: String, body: String) = entry(name,body.toByteArray(Charsets.UTF_8))
            for ((kind, values) in listOf("attachment" to root["attachments"].obj()["payloads"].arr(),"voice" to root["voice"].obj()["payloads"].arr())) {
                for (raw in values) {
                    val item = raw.obj()
                    val id = item.str("id")
                    val clip = if(kind=="voice") root["voice"].obj()["clips"].arr().map { it.obj() }.find { it.str("id")==id } else null
                    try {
                        require(item.str("unavailable")!="true") { "原件不可用" }
                        val encoded = if(item["chunks"] is JsonArray) item["chunks"].arr().map { it.jsonPrimitive.content } else listOf(item.str("data_base64").ifEmpty { item.str("data_b64") })
                        require(encoded.isNotEmpty() && (encoded.any { it.isNotEmpty() } || item.str("size")=="0")) { "缺少原件" }
                        val chunks = encoded.map { Base64.getDecoder().decode(it) }
                        val size = chunks.sumOf { it.size.toLong() }
                        val expected = (item.str("audio_bytes").ifEmpty { item.str("size") }).toLongOrNull()
                        require(expected==null || expected==size) { "原件长度不一致" }
                        val mime = item.str("mime").ifEmpty { clip?.str("mime").orEmpty().ifEmpty { if(kind=="voice") "audio/mpeg" else "application/octet-stream" } }
                        val path = "media/"+(media.size+1)+"."+(extensions[mime] ?: "bin")
                        zip.putNextEntry(ZipEntry(path)); chunks.forEach { zip.write(it) }; zip.closeEntry()
                        val row = buildJsonObject {
                            put("kind",kind);put("id",id);put("conversation_id",item.str("conversation_id").ifEmpty { clip?.str("conversation_id").orEmpty() })
                            put("name",item.str("name").ifEmpty { clip?.str("name").orEmpty().ifEmpty { id } });put("mime",mime);put("path",path);put("size",size)
                        }
                        media.add(row); if(kind=="attachment") attachments[row.str("conversation_id")+":"+id]=row
                    } catch (e: IllegalArgumentException) { warnings.add("$kind $id："+e.message) }
                }
            }
            root["chat"].obj()["conversations"].arr().forEachIndexed { i, raw ->
                val row=raw.obj();val conversation=row["conversation"].obj();val history=row["history"].obj()
                val title=conversation.str("title").ifEmpty { conversation.str("id") };val path="chats/"+(i+1)+".html"
                nav.add("""<li><a href="$path">"""+esc(title)+"</a></li>")
                fun article(v: JsonObject,role: String,label: String): String = buildString {
                    append("""<article class="$role"><small>"""+esc(label)+" · "+esc(v.str("created_at"))+"""</small><div style="white-space:pre-wrap;overflow-wrap:anywhere">"""+esc(v.str("content"))+"</div>")
                    v["attachments"].arr().forEach { a -> val item=a.obj();val m=attachments[conversation.str("id")+":"+item.str("id")]
                        append(if(m!=null)mediaHtml(m,"../") else "<p>原件未归档："+esc(item.str("name"))+"</p>") }
                    v["desk_slip"]?.takeUnless { it==JsonNull }?.let { append("<details><summary>历史回执</summary><pre>"+esc(it.toString())+"</pre></details>") }
                    if(v["usage"]!=null||v["model_echo"]!=null)append("<details><summary>模型回波与用量</summary><pre>"+esc(JsonObject(v.filterKeys{it in setOf("usage","model_echo")}).toString())+"</pre></details>")
                    append("</article>")
                }
                val rows=buildString {
                    history["turns"].arr().forEachIndexed { j,t ->
                        val turn=t.obj();append("<section><h2>第 "+(j+1)+" 轮</h2>")
                        turn["user"].obj()["variants"].arr().forEachIndexed { k,v -> append(article(v.obj(),"user","用户变体 "+(k+1))) }
                        turn["assistant"].obj()["variantsByUserVariant"].obj().forEach { (key,vs) ->
                            vs.arr().forEachIndexed { k,v -> append(article(v.obj(),"assistant","分支 $key · 回复 "+(k+1))) } }
                        append("</section>")
                    }
                }
                text(path,page(title,"<a href=\"../index.html\">返回海岸</a><h1>"+esc(title)+"</h1>"+rows))
            }
            val metadata=JsonObject(root.mapValues { (key,value) -> if(key in setOf("attachments","voice")) JsonObject(value.obj().filterKeys { it!="payloads" }) else value })
            metadata.forEach { (key,value) ->
                if(key!="chat") { val path="sections/"+(sections.size+1)+".html"; sections.add("""<li><a href="$path">"""+esc(key)+"</a></li>")
                    text(path,page(key,"<a href=\"../index.html\">返回海岸</a><h1>"+esc(key)+"</h1><pre>"+esc(value.toString())+"</pre>")) }
            }
            val manifest=buildJsonObject { put("format","elementera-coast-offline-html");put("version",1);put("media",JsonArray(media));put("warnings",JsonArray(warnings.map(::JsonPrimitive)));put("excluded_modules",root["excluded_modules"]?:JsonArray(emptyList()));put("restore_supported",false) }
            text("manifest.json",manifest.toString());text("data.json",metadata.toString())
            text("index.html",page("Elementera Coast","<h1>Elementera Coast · 离线海岸</h1><p>只读归档，解压整个 ZIP 后浏览。不是恢复包。</p><p>"+esc(root.str("exported_at"))+"</p><section><h2>归档范围</h2><pre>"+esc(manifest.toString())+"</pre></section><section><h2>聊天窗口</h2><ul>"+nav.joinToString("")+"</ul></section><section><h2>其他资料</h2><ul>"+sections.joinToString("")+"</ul></section><section><h2>原件</h2>"+media.joinToString("") { mediaHtml(it) }+"</section><p><a href=\"manifest.json\">归档清单</a> · <a href=\"data.json\">结构化资料</a></p>"))
        }
        return warnings
    }
}
