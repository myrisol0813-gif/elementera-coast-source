package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** Canonical owner records, shared by local UI and ZIP. Binary objects are
 * indexed by verified content digest; no imported path or provider key is used. */
internal class LocalSideRecords(private val store:LocalPersistence) {
    data class Row(val kind:String,val data:JsonObject,val digest:String?=null){
        val module get()=moduleFor(kind)
        val id get()=identity(kind,data)
        val key get()=module+"/"+id
        val dependencies get()=links(kind,data)
    }
    fun rows():List<Row>{
        val raw=store.get(KEY)
        if(raw.isEmpty())return emptyList()
        return Json.parseToJsonElement(raw).jsonArray.map{v->
            val x=v.jsonObject;require(x.keys==setOf("kind","data","digest"))
            Row(x.str("kind"),x.getValue("data").jsonObject,x["digest"]?.jsonPrimitive?.contentOrNull).also(::validate)
        }.also{require(it.map{r->r.key}.distinct().size==it.size)}
    }
    fun bytes(row:Row):ByteArray{
        val digest=requireNotNull(row.digest)
        val b=requireNotNull(store.getBinary(binaryKey(digest))){"原件缺失。"}
        require(ArchiveV2Chunks.digest(b)==digest&&b.size.toLong()==size(row)){"原件校验失败。"}
        validateBytes(row,b)
        return b
    }
    fun save(next:List<Row>){
        next.forEach(::validate);require(next.map{it.key}.distinct().size==next.size)
        store.put(KEY,JsonArray(next.map{r->buildJsonObject{put("kind",r.kind);put("data",r.data);put("digest",r.digest?.let(::JsonPrimitive)?:JsonNull)}}).toString())
        require(rows()==next)
    }
    fun putOriginal(row:Row,b:ByteArray){
        validate(row);validateBytes(row,b)
        require(row.digest==ArchiveV2Chunks.digest(b)&&size(row)==b.size.toLong())
        store.putBinary(binaryKey(requireNotNull(row.digest)),b);require(bytes(row).contentEquals(b))
    }
    fun removeConversation(cid:String){
        val old=rows();val removed=old.filter{it.kind in setOf("voice","vault_treasures")&&it.data.optional("conversation_id")==cid||it.kind=="vault_media_labels"&&it.data.str("source_key").startsWith("image:$cid:")}
        require(old.none{it.kind=="library_notes"&&it.data.optional("conversation_id")==cid}){"书房笔记仍引用原窗口，不能删除。"}
        save(old-removed.toSet())
        val retained=(old-removed.toSet()).mapNotNull{it.digest}.toSet()
        removed.mapNotNull{it.digest}.filter{it !in retained}.distinct().forEach{store.remove(binaryKey(it))}
    }
    fun clips(cid:String)=rows().filter{it.kind=="voice"&&it.data.str("conversation_id")==cid}.sortedBy{it.data.number("created_at")}.map{it.data}
    fun audio(id:String):Row?=rows().find{it.kind=="voice"&&it.id==id}
    fun cover(id:String):Row?=rows().find{it.kind=="library_covers"&&it.data.str("book_id")==id}
    fun books():List<JsonObject>{
        val all=rows();return all.filter{it.kind=="library_books"}.sortedByDescending{it.data.number("updated_at")}.map{r->
            val id=r.data.str("id");val list=all.filter{it.data.optional("book_id")==id}
            val progress=list.find{it.kind=="library_progress"&&it.data.str("author")=="owner"}?.data
            JsonObject(r.data+buildJsonObject{
                put("chapters_count",list.count{it.kind=="library_chapters"});put("has_cover",list.any{it.kind=="library_covers"})
                put("reader_chapter_index",progress?.get("chapter_index")?:JsonNull);put("reader_paragraph_index",progress?.get("paragraph_index")?:JsonNull)
                for((author,key) in listOf("owner" to "owner_notes","assistant" to "model_partner_notes"))put(key,list.count{it.kind=="library_notes"&&it.data.str("author")==author&&it.data.str("kind")!="highlight"})
            })
        }
    }
    fun book(id:String):JsonObject{
        val root=requireNotNull(books().find{it.str("id")==id}){"书籍不存在。"}
        val linked=rows().filter{it.data.optional("book_id")==id}
        return JsonObject(root+buildJsonObject{
            put("chapters",JsonArray(linked.filter{it.kind=="library_chapters"}.sortedBy{it.data.number("chapter_index")}.map{v->buildJsonObject{put("chapter_index",v.data.getValue("chapter_index"));put("title",v.data.getValue("title"));put("chars",v.data.str("body").length)}}))
            put("progress",JsonArray(linked.filter{it.kind=="library_progress"&&it.data.str("author")=="owner"}.map{wireNote(it.data)}))
            put("reading_logs",JsonArray(linked.filter{it.kind=="library_reading_logs"&&it.data.str("author")=="owner"}.sortedByDescending{it.data.str("day")}.take(60).map{wireNote(it.data)}))
        })
    }
    fun chapter(id:String,index:Int,start:Int=0,limit:Int?=null):JsonObject{
        val row=requireNotNull(rows().find{it.kind=="library_chapters"&&it.data.str("book_id")==id&&it.data.number("chapter_index")==index.toLong()}){"章节不存在。"}
        val paragraphs=paragraphs(row.data.str("body"));require(start>=0&&(limit==null||limit in 1..12))
        val selected=if(limit==null)paragraphs else paragraphs.drop(start).take(limit)
        return buildJsonObject{put("book_id",id);put("chapter_index",index);put("chapter_title",row.data.str("title"));put("paragraph_count",paragraphs.size);put("paragraphs",JsonArray(selected.mapIndexed{i,v->buildJsonObject{put("index",start+i);put("text",v)}}));if(limit!=null){put("start_paragraph",start);put("limit",limit);put("next_paragraph",if(start+limit<paragraphs.size)JsonPrimitive(start+limit)else JsonNull)}}
    }
    fun notes(id:String):List<JsonObject>{
        book(id);return rows().filter{it.kind=="library_notes"&&it.data.str("book_id")==id}.sortedBy{it.data.number("created_at")}.map{wireNote(it.data)}
    }
    fun progress(id:String,chapter:Int,paragraph:Int):JsonObject{
        val selected=this.chapter(id,chapter,paragraph,1).getValue("paragraphs").jsonArray;require(selected.isNotEmpty()){"阅读进度必须指向原文。"}
        val now=System.currentTimeMillis()
        val value=buildJsonObject{put("book_id",id);put("author","owner");put("chapter_index",chapter);put("paragraph_index",paragraph);put("updated_at",now)}
        val date=Instant.ofEpochMilli(now).toString().take(10)
        val progress=Row("library_progress",value);val log=Row("library_reading_logs",JsonObject(value+("day" to JsonPrimitive(date))))
        save(rows().filterNot{it.key==progress.key||it.key==log.key}+listOf(progress,log))
        return wireNote(value)
    }
    fun importBook(payload:JsonObject):JsonObject{
        val old=rows();require(old.count{it.kind=="library_books"}<80){"书架最多80本。"}
        val now=System.currentTimeMillis();val id=UUID.randomUUID().toString()
        val book=Row("library_books",buildJsonObject{put("id",id);put("title",payload.str("title").trim());put("format",payload.str("format").lowercase());put("created_at",now);put("updated_at",now)})
        val chapters=payload.getValue("chapters").jsonArray.mapIndexed{i,v->val c=v.jsonObject;Row("library_chapters",buildJsonObject{put("book_id",id);put("chapter_index",i);put("title",c.str("title").trim());put("body",c.str("body").trim())})}
        val all=old+book+chapters;validateLibrary(all,emptyMap());save(all)
        return this.book(id)
    }
    fun saveCover(id:String,data:ByteArray,mime:String):JsonObject{
        book(id);val row=Row("library_covers",buildJsonObject{put("book_id",id);put("mime",mime);put("size",data.size);put("updated_at",System.currentTimeMillis())},ArchiveV2Chunks.digest(data))
        putOriginal(row,data);save(rows().filterNot{it.key==row.key}+row)
        return buildJsonObject{put("book_id",id);put("has_cover",true);put("size",data.size);put("mime",mime)}
    }
    fun deleteBook(id:String){book(id);save(rows().filterNot{it.kind=="library_books"&&it.id==identity("library_books",buildJsonObject{put("id",id)})||it.data.optional("book_id")==id})}
    fun writeNote(id:String,input:JsonObject):JsonObject{
        book(id);val kind=input.optional("kind")?:"annotation";val now=System.currentTimeMillis()
        val chapter=if(kind=="reflection")null else input.getValue("chapter_index").jsonPrimitive.int
        val paragraph=if(kind=="reflection")null else input.getValue("paragraph_index").jsonPrimitive.int
        val text=if(chapter==null)null else this.chapter(id,chapter,requireNotNull(paragraph),1).getValue("paragraphs").jsonArray.single().jsonObject.str("text")
        val start=input["start_offset"]?.jsonPrimitive?.intOrNull;val end=input["end_offset"]?.jsonPrimitive?.intOrNull
        require((start==null)==(end==null));val quote=if(start==null)text else requireNotNull(text).substring(start,requireNotNull(end))
        val row=Row("library_notes",buildJsonObject{
            put("id",UUID.randomUUID().toString());put("book_id",id);put("chapter_index",chapter?.let(::JsonPrimitive)?:JsonNull);put("paragraph_index",paragraph?.let(::JsonPrimitive)?:JsonNull);put("quote",quote?.let(::JsonPrimitive)?:JsonNull);put("kind",kind);put("body",input.optional("body").orEmpty().trim());put("author","owner");put("source","manual");put("conversation_id",JsonNull);put("source_turn_id",JsonNull);put("created_at",now);put("updated_at",now);put("start_offset",start?.let(::JsonPrimitive)?:JsonNull);put("end_offset",end?.let(::JsonPrimitive)?:JsonNull)
        })
        val next=rows()+row;validateLibrary(next,emptyMap());save(next);return wireNote(row.data)
    }
    fun editNote(id:String,body:String?):JsonObject{
        val old=rows();val row=requireNotNull(old.find{it.kind=="library_notes"&&it.data.str("id")==id&&it.data.str("author")=="owner"}){"只能修改自己的笔记。"}
        if(body==null){save(old-row);return JsonObject(emptyMap())}
        require(row.data.str("kind")!="highlight"&&body.trim().length in 1..4000)
        val next=row.copy(data=JsonObject(row.data+mapOf("body" to JsonPrimitive(body.trim()),"updated_at" to JsonPrimitive(System.currentTimeMillis()))))
        save(old.map{if(it.key==row.key)next else it});return wireNote(next.data)
    }
    fun treasureRows(kind:String,q:String,cid:String,tid:String,cursor:Int):JsonObject{
        val selected=rows().filter{it.kind=="vault_treasures"}.map{it.data}.filter{(kind=="all"||it.str("kind")==kind)&&(cid.isEmpty()||it.str("conversation_id")==cid)&&(tid.isEmpty()||it.optional("turn_id")==tid)&&(q.isEmpty()||listOf(it.str("excerpt"),it.str("notes")).any{t->t.contains(q,true)})}.sortedByDescending{it.number("updated_at")}
        return page(selected.map(::treasureWire),cursor)
    }
    fun media(kind:String,q:String,cursor:Int):JsonObject{
        val all=rows();val treasures=all.filter{it.kind=="vault_treasures"}.associateBy{it.data.str("source_key")}
        val labels=all.filter{it.kind=="vault_media_labels"}.associateBy{it.data.str("source_key")}
        val media=LocalAttachmentStore(store).entries().map{it.metadata}+all.filter{it.kind=="voice"}.map{it.data}
        val items=media.map{v->
            val k=v.optional("kind")?:"audio";val cid=v.str("conversation_id");val id=v.str("id");val key="$k:$cid:$id";val treasure=treasures[key]?.data
            buildJsonObject{
                put("id",id);put("source_id",id);put("kind",k);put("conversation_id",cid);put("turn_id",v["turn_id"]?:JsonNull);put("message_id",v["message_id"]?:JsonNull);put("role",if(k=="audio")"assistant" else "user")
                put("name",v.optional("name")?:"语音");put("display_name",labels[key]?.data?.optional("display_name")?:v.optional("name")?:"语音");put("source_text",v.optional("text").orEmpty());put("size",v["size"]?:v.getValue("audio_bytes"));put("created_at",v.getValue("created_at"));put("treasure_id",treasure?.get("id")?:JsonNull);put("notes",treasure?.get("notes")?:JsonPrimitive(""))
            }
        }.filter{(kind=="all"||it.str("kind")==kind)&&(q.isEmpty()||listOf(it.str("display_name"),it.str("source_text"),it.str("notes")).any{t->t.contains(q,true)})}.sortedByDescending{it.number("created_at")}
        return page(items,cursor)
    }
    fun saveTreasure(input:JsonObject):JsonObject{
        val kind=input.str("kind");val cid=input.str("conversation_id");val sid=input.str("source_id")
        val h=requireNotNull(RemoteCacheStore(store,strictReads=true).history(cid)){"原窗口不存在。"}
        val source=source(kind,cid,sid,h,rows(),LocalAttachmentStore(store).entries().map{it.metadata},LocalSoilStore(store).read().history)
        val text=source.text;val indices=(input["paragraph_indices"] as? JsonArray)?.map{it.jsonPrimitive.int}?.distinct()?.sorted().orEmpty()
        require(indices.size<=40&&indices.all{it>=0});val parts=paragraphs(text)
        val excerpt=if(indices.isEmpty())text else indices.joinToString("\n\n"){parts[it]}
        val now=System.currentTimeMillis();val key="$kind:$cid:$sid";val old=rows();val prior=old.find{it.kind=="vault_treasures"&&it.data.str("source_key")==key}
        val row=Row("vault_treasures",buildJsonObject{
            put("id",prior?.data?.str("id")?:UUID.randomUUID().toString());put("source_key",key);put("kind",kind);put("conversation_id",cid);put("source_id",sid);put("turn_id",source.turn?.let(::JsonPrimitive)?:JsonNull);put("message_id",source.message?.let(::JsonPrimitive)?:JsonNull);put("role",source.role);put("excerpt",excerpt);put("selections_json",JsonArray(indices.map(::JsonPrimitive)).toString());put("notes",input.optional("notes").orEmpty().trim());put("created_at",prior?.data?.number("created_at")?:now);put("updated_at",now)
        })
        save(old.filterNot{it.key==row.key}+row);return treasureWire(row.data)
    }
    fun changeTreasure(id:String,notes:String?):JsonObject{
        val old=rows();val row=requireNotNull(old.find{it.kind=="vault_treasures"&&it.data.str("id")==id}){"收藏不存在。"}
        if(notes==null){save(old-row);return JsonObject(emptyMap())}
        val next=row.copy(data=JsonObject(row.data+mapOf("notes" to JsonPrimitive(notes),"updated_at" to JsonPrimitive(System.currentTimeMillis()))))
        save(old.map{if(it.key==row.key)next else it});return treasureWire(next.data)
    }
    fun renameImage(input:JsonObject):JsonObject{
        val cid=input.str("conversation_id");val id=input.str("source_id");val key="image:$cid:$id"
        require(LocalAttachmentStore(store).entries().any{it.metadata.str("conversation_id")==cid&&it.metadata.str("id")==id&&it.metadata.str("kind")=="image"}){"原图片不存在。"}
        val row=Row("vault_media_labels",buildJsonObject{put("source_key",key);put("display_name",input.str("display_name").trim());put("updated_at",System.currentTimeMillis())})
        save(rows().filterNot{it.key==row.key}+row);return row.data
    }
    companion object{
        const val KEY="local.side.records.v2"
        val modules=setOf("voice","vault","library")
        private val specs=mapOf(
            "voice" to "id,conversation_id,turn_id,message_id,source,model_label,voice_id,text,audio_bytes,created_at",
            "vault_treasures" to "id,source_key,kind,conversation_id,turn_id,message_id,source_id,role,excerpt,selections_json,notes,created_at,updated_at",
            "vault_media_labels" to "source_key,display_name,updated_at",
            "library_books" to "id,title,format,created_at,updated_at",
            "library_chapters" to "book_id,chapter_index,title,body",
            "library_notes" to "id,book_id,chapter_index,paragraph_index,quote,kind,body,author,source,conversation_id,source_turn_id,created_at,updated_at,start_offset,end_offset",
            "library_progress" to "book_id,author,chapter_index,paragraph_index,updated_at",
            "library_reading_logs" to "book_id,author,day,chapter_index,paragraph_index,updated_at",
            "library_covers" to "book_id,mime,size,updated_at"
        )
        private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
        private val hex=Regex("[0-9a-f]{64}")
        private fun binaryKey(d:String)="local.side.original.v2."+d
        fun JsonObject.str(k:String):String{val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
        fun JsonObject.optional(k:String):String?=this[k]?.jsonPrimitive?.contentOrNull
        fun JsonObject.number(k:String):Long{val v=getValue(k).jsonPrimitive;require(!v.isString);return v.long}
        fun moduleFor(kind:String)=when{kind=="voice"->"voice";kind.startsWith("vault_")->"vault";kind.startsWith("library_")->"library";else->error("不支持的资料类型。")}
        fun identity(kind:String,v:JsonObject):String{
            val fields=when(kind){"voice"->return v.str("id");"vault_media_labels"->listOf("source_key");"library_chapters"->listOf("book_id","chapter_index");"library_progress"->listOf("book_id","author");"library_reading_logs"->listOf("book_id","author","day");"library_covers"->listOf("book_id");else->listOf("id")}
            return kind+":"+ArchiveV2Chunks.digest(JsonArray(fields.map{v.getValue(it)}).toString().encodeToByteArray())
        }
        fun links(kind:String,v:JsonObject):List<String>{
            val result=mutableListOf<String>()
            if(kind.startsWith("library_")&&kind!="library_books")result.add("library/"+identity("library_books",buildJsonObject{put("id",v.str("book_id"))}))
            v.optional("conversation_id")?.let{result.add("chat/"+it)}
            return result
        }
        fun size(r:Row)=when(r.kind){"voice"->r.data.number("audio_bytes");"library_covers"->r.data.number("size");else->0L}
        fun limit(kind:String)=when(kind){"voice"->4L*1024*1024;"library_covers"->600L*1024;else->0L}
        fun paragraphs(text:String)=text.split(Regex("\\n\\s*\\n")).map{it.trim()}.filter{it.isNotEmpty()}
        fun wireNote(v:JsonObject)=JsonObject(v+("author" to JsonPrimitive(if(v.str("author")=="owner")"owner" else "model_partner")))
        fun treasureWire(v:JsonObject)=JsonObject(v+("paragraph_indices" to Json.parseToJsonElement(v.str("selections_json"))))
        fun page(items:List<JsonObject>,cursor:Int):JsonObject{require(cursor>=0);return buildJsonObject{put("items",JsonArray(items.drop(cursor).take(40)));put("next_cursor",if(cursor+40<items.size)JsonPrimitive((cursor+40).toString())else JsonNull)}}
        fun validate(r:Row){
            val v=r.data;require(v.keys==requireNotNull(specs[r.kind]).split(',').toSet()&&v.values.all{it==JsonNull||it is JsonPrimitive&&(it.isString||it.longOrNull!=null)})
            for(k in listOf("id","book_id","conversation_id","source_id","turn_id","message_id","source_turn_id"))v.optional(k)?.let{require(id.matches(it))}
            for(k in listOf("created_at","updated_at"))if(k in v)require(v.number(k)>=0)
            for(k in listOf("chapter_index","paragraph_index","start_offset","end_offset"))if(v[k]!=null&&v[k]!=JsonNull)require(v.number(k) in 0..Int.MAX_VALUE.toLong())
            if(limit(r.kind)>0)require(r.digest!=null&&hex.matches(r.digest)&&size(r) in 1..limit(r.kind))else require(r.digest==null)
            when(r.kind){
                "voice"->{require(v.str("source").length<=160&&v.str("voice_id").length<=180&&v.str("text").length<=2400)}
                "vault_treasures"->{require(v.str("kind") in setOf("text","soil","audio","image","file")&&v.str("source_key")==v.str("kind")+":"+v.str("conversation_id")+":"+v.str("source_id")&&v.str("notes").length<=1200&&v.str("excerpt").length<=12000&&v.str("role") in setOf("user","assistant"));val p=Json.parseToJsonElement(v.str("selections_json")).jsonArray.map{it.jsonPrimitive.int};require(p.size<=40&&p==p.distinct().sorted()&&p.all{it>=0})}
                "vault_media_labels"->require(v.str("source_key").startsWith("image:")&&v.str("source_key").length<=327&&v.str("display_name").length in 1..120&&v.str("display_name").trim()==v.str("display_name")&&v.str("display_name").none{it.code<32||it.code==127})
                "library_books"->require(v.str("title").length in 1..160&&v.str("title").isNotBlank()&&v.str("format") in setOf("epub","txt"))
                "library_chapters"->require(v.str("title").length in 1..160&&v.str("title").isNotBlank()&&v.str("body").length in 1..32000&&paragraphs(v.str("body")).all{it.length<=4000})
                "library_notes"->{require(v.str("author") in setOf("owner","assistant")&&v.str("kind") in setOf("annotation","reflection","highlight")&&v.str("body").length<=4000);require(if(v.str("kind")=="highlight")v.str("body").isEmpty()else v.str("body").isNotBlank())}
                "library_progress","library_reading_logs"->{require(v.str("author") in setOf("owner","assistant"));if(r.kind=="library_reading_logs")require(LocalDate.parse(v.str("day")).toString()==v.str("day"))}
                "library_covers"->require(v.str("mime") in setOf("image/png","image/jpeg"))
            }
        }
        fun validateBytes(r:Row,b:ByteArray){
            if(r.kind=="library_covers"){
                val signature=if(r.data.str("mime")=="image/png")listOf(137,80,78,71,13,10,26,10)else listOf(255,216,255)
                require(b.size>=signature.size&&signature.indices.all{(b[it].toInt() and 255)==signature[it]}){"封面原件格式不正确。"}
            }
        }
        fun validateLibrary(rows:List<Row>,histories:Map<String,RemoteHistory>,checkChats:Boolean=false){
            rows.filter{it.module=="library"}.forEach(::validate)
            val books=rows.filter{it.kind=="library_books"}.associateBy{it.data.str("id")};require(books.size<=80)
            val chapters=rows.filter{it.kind=="library_chapters"}.groupBy{it.data.str("book_id")}
            for(id in books.keys){
                val cs=chapters[id].orEmpty().sortedBy{it.data.number("chapter_index")}
                require(cs.size in 1..2048&&cs.withIndex().all{it.index.toLong()==it.value.data.number("chapter_index")}&&cs.sumOf{it.data.str("body").length.toLong()}<=12000000){"书籍章节缺失或超限。"}
            }
            for(r in rows.filter{it.module=="library"&&it.kind!="library_books"}){
                val v=r.data;val id=v.str("book_id");require(id in books)
                if(r.kind=="library_notes"){
                    if(v.str("kind")=="reflection")require(listOf("chapter_index","paragraph_index","quote","start_offset","end_offset").all{v[it]==JsonNull})
                    else{
                        val c=chapters[id].orEmpty().find{it.data.number("chapter_index")==v.number("chapter_index")}
                        val paragraph=paragraphs(requireNotNull(c).data.str("body"))[v.number("paragraph_index").toInt()]
                        val a=v["start_offset"]?.jsonPrimitive?.intOrNull;val b=v["end_offset"]?.jsonPrimitive?.intOrNull
                        require((a==null)==(b==null))
                        require(if(a==null)v.str("kind")!="highlight"&&v.str("quote")==paragraph else a>=0&&requireNotNull(b)>a&&b<=paragraph.length&&v.str("quote")==paragraph.substring(a,b))
                    }
                    val cid=v.optional("conversation_id");val tid=v.optional("source_turn_id")
                    require(cid!=null||tid==null)
                    if(checkChats&&cid!=null){val h=requireNotNull(histories[cid]){"书房笔记关联原窗口缺失。"};require(tid==null||h.turns.any{it.id==tid})}
                }else if(r.kind in setOf("library_progress","library_reading_logs")){
                    val c=chapters[id].orEmpty().find{it.data.number("chapter_index")==v.number("chapter_index")}
                    require(v.number("paragraph_index") in 0 until paragraphs(requireNotNull(c).data.str("body")).size.toLong())
                }
            }
        }
        data class Source(val turn:String?,val message:String?,val role:String,val text:String)
        fun source(kind:String,cid:String,id:String,h:RemoteHistory,rows:List<Row>,attachments:List<JsonObject>,soil:List<JsonObject>):Source{
            if(kind=="text"){
                for(t in h.turns){t.user.variants.find{it.id==id}?.let{return Source(t.id,id,"user",it.content)}
                    t.assistant.variantsByUserVariant.values.flatten().find{it.id==id}?.let{return Source(t.id,id,"assistant",it.content)}}
            }else if(kind=="soil"){
                val row=soil.find{it.str("conversation_id")==cid&&it.str("assistant_message_id")==id}
                if(row!=null)return Source(row.str("turn_id"),id,"assistant",(listOf(row.str("current_text"))+Json.parseToJsonElement(row.str("afterthoughts_json")).jsonArray.map{it.jsonPrimitive.content}).filter{it.isNotBlank()}.joinToString("\n\n"))
            }else if(kind=="audio"){
                val row=rows.find{it.kind=="voice"&&it.id==id&&it.data.str("conversation_id")==cid}?.data
                if(row!=null)return Source(row.optional("turn_id"),row.optional("message_id"),"assistant",row.str("text"))
            }else if(kind in setOf("image","file")){
                val row=attachments.find{it.str("id")==id&&it.str("conversation_id")==cid&&it.str("kind")==kind}
                if(row!=null)return Source(row.optional("turn_id"),null,"user",row.str("name"))
            }
            error("收藏关联原件不存在。")
        }
    }
}

internal object ArchiveV2SideRecords{
    data class Item(val row:LocalSideRecords.Row,val descriptor:ArchiveV2Object?,val file:File?)
    fun read(m:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>,app:String):List<Item>{
        require("vault" !in selection||m.applicationId==app){"拾潮原始身份暂需同应用恢复。"}
        val objects=m.objects.associateBy{it.objectSha256}
        return m.records.filter{it.module in selection.intersect(LocalSideRecords.modules)}.map{r->
            val raw=Json.parseToJsonElement(stage.verify(objects.getValue(r.recordObject),1800000).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
            require(raw.keys==setOf("kind","data"))
            val kind=raw.getValue("kind").jsonPrimitive.content;val data=raw.getValue("data").jsonObject
            val limit=LocalSideRecords.limit(kind);require(r.mediaObjects.size==if(limit>0)1 else 0)
            val d=r.mediaObjects.singleOrNull()?.let{objects.getValue(it)}
            val f=d?.let{stage.verify(it,limit)}
            val row=LocalSideRecords.Row(kind,data,f?.let{ArchiveV2Chunks.digest(it.readBytes())});LocalSideRecords.validate(row)
            require(r.module==row.module&&r.id==row.id&&r.dependencies.toSet()==row.dependencies.toSet()){"资料原始依赖不一致。"}
            if(d!=null)require(d.size==LocalSideRecords.size(row))
            Item(row,d,f)
        }
    }
    fun apply(items:List<Item>,selection:Set<String>,target:LocalPersistence,histories:Map<String,RemoteHistory>,conflicts:Set<String>,attachments:List<JsonObject>,soil:List<JsonObject>,write:Boolean):Map<String,LocalRestoreCount>{
        val store=LocalSideRecords(target);val old=store.rows();val byKey=old.associateBy{it.key}
        val incoming=items.map{it.row}
        require(incoming.all{byKey[it.key]==null||byKey[it.key]==it}){"目标已存在不同资料，不覆盖。"}
        val next=old+incoming.filter{it.key !in byKey}
        LocalSideRecords.validateLibrary(next,histories,true)
        for(row in incoming){
            val v=row.data
            val cid=v["conversation_id"]?.jsonPrimitive?.contentOrNull
            if(cid!=null)require(cid in histories&&cid !in conflicts){"原窗口缺失或冲突。"}
            if(row.kind=="voice"){
                val h=histories.getValue(requireNotNull(cid));val tid=v["turn_id"]?.jsonPrimitive?.contentOrNull;val mid=v["message_id"]?.jsonPrimitive?.contentOrNull
                require(tid==null||h.turns.any{it.id==tid})
                require(mid==null||h.turns.any{t->(tid==null||tid==t.id)&&(t.user.variants+t.assistant.variantsByUserVariant.values.flatten()).any{it.id==mid}}){"语音的原消息不存在。"}
            }else if(row.kind=="vault_treasures"){
                val kind=v.getValue("kind").jsonPrimitive.content;val id=v.getValue("source_id").jsonPrimitive.content
                val src=LocalSideRecords.source(kind,requireNotNull(cid),id,histories.getValue(cid),next,attachments,soil)
                require(src.turn==v["turn_id"]?.jsonPrimitive?.contentOrNull&&src.message==v["message_id"]?.jsonPrimitive?.contentOrNull&&src.role==v.getValue("role").jsonPrimitive.content){"拾潮原始位置不一致。"}
                require(next.count{it.kind=="vault_treasures"&&it.data["source_key"]==v["source_key"]}==1)
            }else if(row.kind=="vault_media_labels"){
                require(attachments.any{a->a["kind"]==JsonPrimitive("image")&&v["source_key"]==JsonPrimitive("image:"+a["conversation_id"]?.jsonPrimitive?.content+":"+a["id"]?.jsonPrimitive?.content)}){"原图片缺失。"}
            }
        }
        for(item in items){
            val file=item.file?:continue;val d=requireNotNull(item.descriptor)
            val bytes=file.readBytes()
            require(bytes.size.toLong()==d.size&&ArchiveV2Chunks.digest(bytes)==item.row.digest)
            LocalSideRecords.validateBytes(item.row,bytes)
            if(item.row.key in byKey)require(store.bytes(item.row).contentEquals(bytes))else if(write)store.putOriginal(item.row,bytes)
        }
        if(write)store.save(next)
        return selection.intersect(LocalSideRecords.modules).associateWith{module->val group=incoming.filter{it.module==module};val matched=group.count{it.key in byKey};LocalRestoreCount(group.size-matched,matched,0)}
    }
}
