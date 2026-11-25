package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.serialization.json.*

/** Model writes use canonical local stores and retain their source; never impersonate the owner. */
internal class LocalToolWrites(private val s:LocalPersistence,private val cid:String,private val turn:String,
    private val model:String,private val auditId:String) {
    private val cache=RemoteCacheStore(s,strictReads=true)
    private val room=cache.conversations().first{it.id==cid}.roomType
    private val label=model.take(120)
    private val actor="model_partner"
    private val now=Instant.now().toString()
    private val id=UUID.randomUUID().toString()
    private fun JsonObject.text(k:String,max:Int,optional:Boolean=false):String {
        val v=this[k]?:if(optional)return "" else error("缺少字段")
        require(v is JsonPrimitive&&v.isString&&v.content.trim().length<=max)
        val text=v.content.trim();require(optional||text.isNotBlank());return text
    }
    private fun JsonObject.date():String=LocalDate.parse(text("date",10)).also{require(it.year in 1900..2200)}.toString()
    private fun result(id:String)=buildJsonObject{put("ok",true);put("id",id);put("saved",true)}
    fun execute(name:String,input:JsonObject):JsonObject {
        require(label.isNotBlank())
        return when(name){
            "create_moment"->{
                val m=RemoteDailyMoment(id=id,date=input.date(),author=actor,source="chat_tool",
                    text=input.text("text",4000),conversationId=cid,sourceTurnId=turn,surface=if(room=="main")"main_chat"else room,
                    modelLabel=label,displayAuthor=label,actor=actor,toolCallId=auditId,
                    createdAt=now,updatedAt=now,publishedAt=now,likes=emptyList())
                cache.putDailyMoments(listOf(m)+cache.dailyMoments());result(id)
            }
            "create_diary"->{
                val tags=(input["tags"]?:JsonArray(emptyList())).jsonArray
                require(tags.size<=12&&tags.all{it is JsonPrimitive&&it.isString&&it.content.length in 1..80})
                val d=RemoteDailyDiary(id=id,date=input.date(),author=actor,source="chat_tool",
                    weather=input.text("weather",80,true).ifBlank{"未标注"},mood=input.text("mood",80,true).ifBlank{"未标注"},
                    tags=tags.map{it.jsonPrimitive.content}.distinct(),text=input.text("text",6000),conversationId=cid,
                    sourceTurnId=turn,surface=if(room=="main")"main_chat"else room,modelLabel=label,displayAuthor=label,
                    actor=actor,toolCallId=auditId,createdAt=now,updatedAt=now)
                cache.putDailyDiaries(listOf(d)+cache.dailyDiaries());result(id)
            }
            "moment_comment"->{
                val mid=input.text("moment_id",160);val rows=cache.dailyMoments()
                val m=rows.single{it.id==mid}
                val c=RemoteDailyComment(id,author=actor,text=input.text("text",2000),modelId=label,createdAt=now)
                cache.putDailyMoments(rows.map{if(it.id==mid)m.copy(comments=m.comments+c,updatedAt=now)else it});result(id)
            }
            "moment_like"->{
                val mid=input.text("moment_id",160);val rows=cache.dailyMoments();val m=rows.single{it.id==mid}
                val likes=m.likes?:if(m.likeCount==0&&!m.liked)emptyList()else error("旧点赞明细缺失")
                val flag=input.getValue("liked").jsonPrimitive;require(!flag.isString)
                val next=likes.filterNot{it.actor==actor}+if(flag.boolean)listOf(likes.firstOrNull{it.actor==actor}?:RemoteDailyLike(actor,now))else emptyList()
                cache.putDailyMoments(rows.map{if(it.id==mid)m.copy(likes=next,likeCount=next.size,updatedAt=now)else it});result(mid)
            }
            "calendar_create"->{
                val calendar=LocalCalendarStore(s)
                val row=calendar.save(null,buildJsonObject{
                    put("day",input.date());put("title",input.text("title",120));put("body",input.text("body",4000,true))
                    put("kind",input.text("kind",10,true).ifBlank{"event"})
                })
                val key=row.getValue("id").jsonPrimitive.content
                val changed=JsonObject(row+buildJsonObject{
                    put("author","assistant");put("source","chat_tool");put("model_label",label)
                    put("tool_call_id",auditId);put("conversation_id",cid);put("source_turn_id",turn)
                })
                calendar.restoreSnapshot(JsonArray(calendar.snapshot().map{if(it.jsonObject["id"]?.jsonPrimitive?.content==key)changed else it}))
                result(key)
            }
            "library_write"->{
                val book=input.text("book_id",160);val kind=input.text("kind",16)
                require(kind in setOf("annotation","reflection"))
                val side=LocalSideRecords(s)
                val row=side.writeNote(book,JsonObject(input.filterKeys{it!="book_id"}),"assistant",cid,turn)
                result(row.getValue("id").jsonPrimitive.content)
            }
            "memory_write_candidate"->{
                val title=input.text("title",120);val content=input.text("content",2000)
                val dest=input.text("destination",8);require(dest in setOf("memory","seed"))
                val memory=LocalMemoryStore(s);val old=memory.snapshot()
                val fingerprint="tool:"+ArchiveV2Chunks.digest((cid+"\u0000"+dest+"\u0000"+content).encodeToByteArray())
                val prior=old.pockets.firstOrNull{it["fingerprint"]?.jsonPrimitive?.contentOrNull==fingerprint}
                if(prior!=null){require(prior["status"]?.jsonPrimitive?.content=="pending"&&prior["deleted_at"]==JsonNull);return result(prior.getValue("id").jsonPrimitive.content)}
                val time=System.currentTimeMillis();val window=cache.conversations().first{it.id==cid}.title.take(180)
                val row=buildJsonObject{
                    put("id",id);put("conversation_id",cid);put("source_type","turn");put("status","pending")
                    put("title",title);put("life_core",content);put("content",content)
                    for(k in listOf("usage_hint","avoid_hint","suggested_usage_hint","suggested_avoid_hint","tag","migration_status","revision_action"))put(k,"")
                    put("source_ref_json",buildJsonObject{put("conversation_id",cid);put("source_turn_id",turn);put("candidate_id",id);put("suggested_destination",dest);put("model_label",label);put("source_window",window);put("tool_call_id",auditId)}.toString())
                    put("recall_count",0);put("last_recalled_at",JsonNull);put("memory_tags_json","[]");put("supersedes_entry_id",JsonNull);put("last_confirmed_at",JsonNull)
                    put("source_model",label);put("source_window",window);put("source_time",time)
                    put("created_at",time);put("updated_at",time);put("deleted_at",JsonNull)
                    put("source_text",content);put("suggested_title",title);put("suggested_life_core",content);put("candidate_id",id)
                    put("source_refs_json",buildJsonArray{add(buildJsonObject{put("turn_id",turn);put("role","turn")})}.toString())
                    put("source_excerpt","");put("fingerprint",fingerprint);put("resolved_entry_id",JsonNull)
                }
                memory.write(old.copy(pockets=old.pockets+row));result(id)
            }
            else->error("未授权的写入工具")
        }
    }
}
