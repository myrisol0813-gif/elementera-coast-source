package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.local.*
import kotlinx.serialization.json.*
import java.io.File
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** The reading copy is derived from the same verified objects as V2, never from
 * the obsolete lightweight snapshot. No restoration or live data writes. */
internal object OfflineV2HtmlArchive {
    private fun JsonElement?.obj()=this as? JsonObject ?: JsonObject(emptyMap())
    private fun JsonElement?.arr()=this as? JsonArray ?: JsonArray(emptyList())
    private fun JsonObject.s(k:String)=(this[k] as? JsonPrimitive)?.contentOrNull.orEmpty()
    private fun esc(s:String)=s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;")
    private val labels=mapOf("chat" to "聊天","attachments" to "附件","voice" to "语音","vault" to "拾潮","library" to "书房","calendar" to "日历","daily" to "日常","thinking_soil" to "思维壤","thinking_soil_history" to "思维壤历史","user_portrait" to "用户画像","self_portrait" to "自我画像","tools" to "工具历史")
    private val extensions=mapOf("image/png" to "png","image/jpeg" to "jpg","image/webp" to "webp","image/gif" to "gif","audio/mpeg" to "mp3","audio/wav" to "wav","audio/ogg" to "ogg","audio/mp4" to "m4a","video/mp4" to "mp4","text/plain" to "txt","application/pdf" to "pdf")
    private val style="body{font:15px/1.75 system-ui,sans-serif;background:#f6f4ef;color:#3d454b;margin:0}main{max-width:780px;margin:auto;padding:22px 16px}article,section{background:#fffdf9;padding:16px;margin:13px 0;border-radius:7px;box-shadow:0 2px 8px #3331}article.user{background:#eef3f5}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:12px/1.6 monospace}small{color:#737a80}a{color:#496c82}img,audio,video{display:block;max-width:100%;margin:10px 0}img{max-height:65vh;object-fit:contain}.cover{width:110px;aspect-ratio:2/3;object-fit:cover;box-shadow:3px 3px 0 #ded7c7}.book{display:flex;gap:16px;align-items:start}blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #b7a784}summary{cursor:pointer}li{margin:6px 0}"
    private fun page(title:String,body:String)= "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' file:; media-src 'self' file:\"><title>"+esc(title)+"</title><style>"+style+"</style></head><body><main>"+body+"</main></body></html>"
    private fun time(s:String)=s.toLongOrNull()?.let { java.time.Instant.ofEpochMilli(it).toString() } ?: s
    private data class Item(val row:ArchiveV2Record,val kind:String,val data:JsonObject,val index:Int) {
        val path get()="records/$index.html"
        val jsonPath get()="records/$index.json"
    }
    private data class Media(val id:String,val path:String,val mime:String,val name:String)
    private fun media(m:Media,prefix:String="../"):String {
        val url=esc(prefix+m.path);val name=esc(m.name)
        return "<a href=\"$url\" download>$name</a>"+when(m.mime){
            "image/png","image/jpeg","image/webp","image/gif"->"<img loading=\"lazy\" src=\"$url\" alt=\"$name\">"
            "audio/mpeg","audio/wav","audio/ogg","audio/mp4"->"<audio controls preload=\"none\" src=\"$url\"></audio>"
            "video/mp4"->"<video controls preload=\"none\" src=\"$url\"></video>"
            else->""
        }
    }
    fun write(source:File,output:OutputStream,device:JsonElement?=null):List<String> {
        val parent=requireNotNull(source.parentFile)
        val temp=java.nio.file.Files.createTempDirectory(parent.toPath(),"html-verified-").toFile()
        try {
            val stage=ArchiveV2Stage(temp,"objects")
            val manifest=ArchiveV2ZipReader.stage(source,stage)
            val objects=manifest.objects.associateBy { it.objectSha256 }
            val warnings=mutableListOf<String>()
            val files=manifest.records.mapIndexed { i,r->
                val d=objects.getValue(r.recordObject)
                val record=Json.parseToJsonElement(stage.verify(d,d.size).readText()).jsonObject
                val data=record.getValue("data").jsonObject
                // Keep only indices and small metadata in memory; full text is read
                // from staged records again when generating individual pages.
                Item(r,record.getValue("kind").jsonPrimitive.content,JsonObject(data.filterKeys { it !in setOf("history","history_json","body") }),i+1)
            }
            fun full(item:Item):JsonObject {
                val d=objects.getValue(item.row.recordObject)
                return Json.parseToJsonElement(stage.verify(d,d.size).readText()).jsonObject.getValue("data").jsonObject
            }
            val mediaByRecord=mutableMapOf<String,List<Media>>()
            val mediaByHash=mutableMapOf<String,String>()
            val attachments=mutableMapOf<String,Media>();val voices=mutableMapOf<String,Media>()
            val chapters=files.filter{it.kind=="library_chapters"}.groupBy{it.data.s("book_id")}
            val notes=files.filter{it.kind=="library_notes"}.groupBy{it.data.s("book_id")}
            val books=files.filter{it.kind=="library_books"}
            val covers=files.filter{it.kind=="library_covers"}.associateBy{it.data.s("book_id")}
            val progress=files.filter{it.kind=="library_progress"}.groupBy{it.data.s("book_id")}
            val chatLinks=files.filter{it.row.module=="chat"}.associateBy{it.row.id}
            val byRecord=files.associateBy{it.row.module+"/"+it.row.id}
            fun key(item:Item)=item.row.module+"/"+item.row.id
            fun title(item:Item):String=when(item.kind){
                "local_chat","chat"->item.data["conversation"].obj().s("title").ifBlank{item.row.id}
                "library_books","library_chapters"->item.data.s("title").ifBlank{item.kind}
                "library_notes"->when(item.data.s("kind")){"highlight"->"划线";"annotation"->"批注";else->"读后感"}
                "vault_stickers"->"表情包 · "+item.data.s("description").take(45)
                "vault_treasures"->item.data.s("display_name").ifBlank{item.data.s("kind")+" · "+item.data.s("source_id")}
                else->item.data.s("name").ifBlank{item.data.s("title").ifBlank{item.kind+" · "+item.row.id}}
            }
            ZipOutputStream(output).use { zip->
                fun text(path:String,body:String){zip.putNextEntry(ZipEntry(path));zip.write(body.encodeToByteArray());zip.closeEntry()}
                for(item in files){
                    val own=mutableListOf<Media>()
                    for(hash in item.row.mediaObjects){
                        val d=objects.getValue(hash)
                        val mime=item.data.s("mime").ifBlank{if(item.kind=="voice")"audio/mpeg" else "application/octet-stream"}
                        val path=mediaByHash[hash]?:("media/"+(mediaByHash.size+1)+"."+(extensions[mime]?:"bin")).also { path->
                            val original=stage.verify(d,d.size)
                            zip.putNextEntry(ZipEntry(path));original.inputStream().use{it.copyTo(zip)};zip.closeEntry()
                            mediaByHash[hash]=path
                        }
                        own.add(Media(item.data.s("id").ifBlank{item.row.id},path,mime,item.data.s("name").ifBlank{title(item)}))
                    }
                    mediaByRecord[key(item)]=own
                    val first=own.firstOrNull()
                    if(first!=null&&item.kind=="attachment")attachments[item.data.s("conversation_id")+":"+item.data.s("id")]=first
                    if(first!=null&&item.kind=="voice")voices[item.data.s("conversation_id")+":"+item.data.s("id")]=first
                }
                for(item in files){
                    val data=full(item)
                    val header="<a href=\"../index.html\">返回归档</a><h1>"+esc(title(item))+"</h1>"
                    val body=when {
                        item.row.module=="chat"->{
                            val conv=data["conversation"].obj()
                            val history=(data["history"]?:data["history_json"]).let { if(it is JsonPrimitive)Json.parseToJsonElement(it.content).obj() else it.obj() }
                            fun variant(v:JsonObject,role:String,label:String)=buildString{
                                append("<article class=\"$role\"><small>"+esc(label)+" · "+esc(time(v.s("created_at")))+"</small><p>"+esc(v.s("content"))+"</p>")
                                for(a in v["attachments"].arr()){
                                    val ref=a.obj();val m=attachments[conv.s("id")+":"+ref.s("id")]
                                    if(m!=null)append(media(m)) else {append("<p>原件未归档："+esc(ref.s("name"))+"</p>");warnings.add("聊天附件未匹配："+ref.s("id"))}
                                }
                                v["desk_slip"]?.takeIf{it!=JsonNull}?.let{append("<details><summary>历史桌面</summary><pre>"+esc(it.toString())+"</pre></details>")}
                                if(v["usage"]!=null||v["model_echo"]!=null)append("<details><summary>模型回波与用量</summary><pre>"+esc(JsonObject(v.filterKeys{it in setOf("usage","model_echo")}).toString())+"</pre></details>")
                                append("</article>")
                            }
                            buildString {
                                history["turns"].arr().forEachIndexed{j,t->
                                    val turn=t.obj();append("<section><h2>第 "+(j+1)+" 轮</h2>")
                                    turn["user"].obj()["variants"].arr().forEachIndexed{k,v->append(variant(v.obj(),"user","用户变体 "+(k+1)))}
                                    turn["assistant"].obj()["variantsByUserVariant"].obj().forEach{(k,vs)->vs.arr().forEachIndexed{l,v->append(variant(v.obj(),"assistant","分支 $k · 回复 "+(l+1)))}}
                                    append("</section>")
                                }
                                val linked=files.filter{it.kind=="voice"&&it.data.s("conversation_id")==conv.s("id")}
                                if(linked.isNotEmpty())append("<section><h2>本窗口语音</h2>"+linked.joinToString(""){v->mediaByRecord[key(v)].orEmpty().joinToString(""){media(it)}}+"</section>")
                            }
                        }
                        item.kind=="library_books"->buildString {
                            val id=data.s("id");val cover=covers[id]?.let{mediaByRecord[key(it)]?.firstOrNull()}
                            append("<section class=\"book\">")
                            if(cover!=null)append("<img class=\"cover\" src=\"../"+esc(cover.path)+"\" alt=\"封面\">")
                            append("<div><h2>"+esc(data.s("title"))+"</h2><small>"+esc(data.s("format"))+"</small></div></section>")
                            append("<section><h2>阅读位置</h2>")
                            for(pr in progress[id].orEmpty())append("<p>"+esc(pr.data.s("author"))+" · 第 "+((pr.data.s("chapter_index").toIntOrNull()?:0)+1)+" 分段</p>")
                            if(progress[id].isNullOrEmpty())append("<p>暂无记录</p>")
                            append("</section><section><h2>目录</h2><ul>")
                            for(ch in chapters[id].orEmpty().sortedBy{it.data.s("chapter_index").toIntOrNull()?:0})append("<li><a href=\""+ch.index+".html\">"+esc(title(ch))+"</a></li>")
                            append("</ul></section><section><h2>书页间的笔迹</h2>")
                            for(n in notes[id].orEmpty().sortedByDescending{it.data.s("created_at").toLongOrNull()?:0}) {
                                val v=full(n)
                                val ch=chapters[id].orEmpty().firstOrNull{it.data.s("chapter_index")==v.s("chapter_index")}
                                val para=v.s("paragraph_index").toIntOrNull()
                                append("<article><small>"+esc(v.s("author"))+" · "+esc(title(n))+" · "+esc(time(v.s("created_at")))+"</small>")
                                if(v.s("updated_at")!=v.s("created_at"))append("<small> · 编辑于 "+esc(time(v.s("updated_at")))+"</small>")
                                if(v.s("quote").isNotBlank())append("<blockquote>"+esc(v.s("quote"))+"</blockquote>")
                                append("<p>"+esc(v.s("body"))+"</p>")
                                if(ch!=null&&para!=null)append("<a href=\""+ch.index+".html#p-"+para+"\">回到原文</a>") else if(v.s("kind")=="reflection")append("<small>整本书的读后感</small>")
                                append("</article>")
                            }
                            append("</section>")
                        }
                        item.kind=="library_chapters"->buildString {
                            val id=data.s("book_id")
                            books.firstOrNull{it.data.s("id")==id}?.let{append("<a href=\""+it.index+".html\">返回阅读档案</a>")}
                            data.s("body").split(Regex("\\n\\s*\\n")).map{it.trim()}.filter{it.isNotEmpty()}.forEachIndexed{i,para->append("<p id=\"p-$i\">"+esc(para)+"</p>")}
                        }
                        item.kind=="vault_stickers"->buildString {
                            val m=attachments[data.s("conversation_id")+":"+data.s("attachment_id")]
                            append("<article><small>"+(if(data.s("author")=="assistant")"模型添加" else "屋主添加")+" · "+(if(data.s("enabled")=="1")"已启用" else "已停用")+" · "+esc(time(data.s("created_at")))+"</small><p>"+esc(data.s("description"))+"</p>")
                            if(m!=null)append(media(m)) else {append("<p>原件未归档。</p>");warnings.add("表情包原件未匹配："+data.s("id"))}
                            append("</article>")
                        }
                        item.kind=="vault_treasures"->buildString {
                            append("<article><small>"+esc(data.s("kind"))+" · "+esc(time(data.s("created_at")))+"</small><p>"+esc(data.s("excerpt"))+"</p><p>"+esc(data.s("notes"))+"</p>")
                            val lookup=data.s("conversation_id")+":"+data.s("source_id")
                            val m=if(data.s("kind")=="audio")voices[lookup] else attachments[lookup]
                            if(m!=null)append(media(m))
                            chatLinks[data.s("conversation_id")]?.let{append("<a href=\""+it.index+".html\">回到来源窗口</a>")}
                            append("</article>")
                        }
                        else->"<section><pre>"+esc(data.toString())+"</pre>"+mediaByRecord[key(item)].orEmpty().joinToString(""){media(it)}+"</section>"
                    }
                    val deps=item.row.dependencies.mapNotNull{byRecord[it]}.joinToString(""){"<li><a href=\""+it.index+".html\">"+esc(title(it))+"</a></li>"}
                    text(item.path,page(title(item),header+body+(if(deps.isNotEmpty())"<details><summary>关联资料</summary><ul>$deps</ul></details>" else "")+"<p><a href=\""+item.index+".json\">结构化记录</a></p>"))
                    text(item.jsonPath,buildJsonObject{put("kind",item.kind);put("data",data)}.toString())
                }
                val nav=manifest.modules.joinToString(""){module->
                    val rows=files.filter{it.row.module==module.module}
                    val shown=if(module.module=="library")rows.filter{it.kind=="library_books"} else rows
                    "<section><h2>"+esc(labels[module.module]?:module.module)+"</h2><small>"+module.count+" 项 · "+esc(module.coverage)+"</small><ul>"+shown.joinToString(""){"<li><a href=\""+it.path+"\">"+esc(title(it))+"</a></li>"}+"</ul></section>"
                }
                if(device!=null)text("device.json",device.toString())
                val meta=buildJsonObject{
                    put("format","elementera-coast-offline-html");put("version",2);put("restore_supported",false);put("workspace",manifest.workspace);put("exported_at",manifest.exportedAt);put("device_settings",device!=null)
                    put("source_coverage",Json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(ArchiveV2Coverage.serializer()),manifest.modules))
                    put("warnings",JsonArray(warnings.distinct().map(::JsonPrimitive)))
                    put("excluded_modules",JsonArray(manifest.modules.filter{it.coverage=="unavailable"}.map{JsonPrimitive(it.module)}))
                    put("media",JsonArray(mediaByHash.map{(h,path)->buildJsonObject{put("object_sha256",h);put("path",path)}}))
                    put("records",JsonArray(files.map{item->buildJsonObject{put("module",item.row.module);put("id",item.row.id);put("kind",item.kind);put("path",item.path);put("json",item.jsonPath);put("media",JsonArray(mediaByRecord[key(item)].orEmpty().map{JsonPrimitive(it.path)}))}}))
                }
                text("manifest.json",meta.toString());text("data.json",meta.toString())
                text("index.html",page("离线归档","<h1>离线海岸</h1><p>由已校验的 V2 记录生成 · 只读，不是恢复包。</p><p>"+esc(manifest.exportedAt)+"</p><p>partial 表示源采集范围尚未声明完整；空记录与未采集不同。</p><p><a href=\"manifest.json\">归档清单</a>"+(if(device!=null)" · <a href=\"device.json\">本机设置</a>" else "")+"</p>"+warnings.distinct().joinToString(""){"<p>"+esc(it)+"</p>"}+nav))
            }
            return warnings.distinct()
        }finally{temp.deleteRecursively()}
    }
}
