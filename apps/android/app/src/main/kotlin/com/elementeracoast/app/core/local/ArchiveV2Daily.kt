package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import java.time.Instant

/** Assemble cloud daily parent/child rows into the existing portable daily contract.
 * No inferred likes, fabricated actors or fallback display identities. */
internal object ArchiveV2Daily {
    data class Row(val record:ArchiveV2Record,val kind:String,val data:JsonObject)
    data class Result(val moments:JsonArray,val diaries:JsonArray,val profile:JsonElement)
    private val common=setOf("id","date","author","source","text","conversation_id","source_turn_id","tool_call_id","actor","surface","model_label","model_nickname","symbol","display_author","created_at","updated_at")
    private val profileFields=mapOf("owner_avatar_dataurl" to "owner_avatar_dataurl","model_partner_avatar_dataurl" to "model_partner_avatar_dataurl","model_partner_display_name" to "model_partner_display_name")
    private val fields=mapOf(
        "daily_moments" to common+setOf("status","reason","published_at"),
        "daily_diaries" to common+setOf("weather","mood","tags_json"),
        "daily_comments" to setOf("id","moment_id","author","text","created_at","model_id","usage_json"),
        "daily_likes" to setOf("moment_id","actor","created_at"),
        "daily_profile" to profileFields.keys+setOf("id","moment_cover_dataurl","updated_at")
    )
    private val safeId=Regex("[A-Za-z0-9_.:-]{1,160}")
    private fun JsonObject.str(k:String)=getValue(k).jsonPrimitive.content
    private fun JsonObject.optional(k:String)=getValue(k).jsonPrimitive.contentOrNull
    private fun role(v:JsonElement):JsonElement {
        if(v==JsonNull)return JsonNull
        require(v is JsonPrimitive&&v.isString)
        return JsonPrimitive(when(v.content){
            "owner"->"owner"
            "model_partner"->"model_partner"
            "api","mcp"->v.content
            else->error("日常作者身份与归档版本不一致。")
        })
    }
    private fun time(v:JsonElement):JsonElement {
        if(v==JsonNull)return JsonNull
        require(v is JsonPrimitive&&!v.isString&&v.long>=0)
        return JsonPrimitive(Instant.ofEpochMilli(v.long).toString())
    }
    private fun identity(kind:String,values:List<JsonElement>)=kind+":"+ArchiveV2Chunks.digest(JsonArray(values).toString().encodeToByteArray())
    private fun common(row:Row):Map<String,JsonElement> {
        val d=row.data
        val parent=d.optional("conversation_id")
        require(row.record.dependencies==if(parent==null)emptyList() else listOf("chat/"+parent))
        require(parent!=null||d["source_turn_id"]==JsonNull)
        for(k in listOf("conversation_id","source_turn_id","tool_call_id"))require(d.optional(k)?.let(safeId::matches)!=false)
        require(d.str("source") in setOf("manual","chat_tool"))
        for(k in listOf("surface","display_author"))require(d[k]!=JsonNull&&d.str(k).isNotEmpty()){"旧日常记录缺少原始显示身份，未用默认值替换。"}
        require(d["symbol"]!=JsonNull&&d["author"]!=JsonNull)
        return d.filterKeys { it in common }.toMutableMap().apply {
            for(k in listOf("created_at","updated_at")){require(d[k]!=JsonNull);this[k]=time(d.getValue(k))}
            for(k in listOf("author","actor"))this[k]=role(d.getValue(k))
        }
    }
    fun convert(rows:List<Row>):Result {
        val groups=rows.groupBy { it.kind }
        for(row in rows){
            val d=row.data
            require(row.record.mediaObjects.isEmpty()&&d.keys==fields[row.kind]){"日常原始字段不兼容，未恢复。"}
            val keys=if(row.kind=="daily_likes")listOf("moment_id","actor") else listOf("id")
            require(keys.all { d[it] is JsonPrimitive&&d.getValue(it).jsonPrimitive.isString&&safeId.matches(d.str(it)) })
            require(row.record.id==identity(row.kind,keys.map(d::getValue))){"日常记录身份校验失败。"}
        }
        val parents=groups["daily_moments"].orEmpty().associateBy { it.data.str("id") }
        val commentsByMoment=groups["daily_comments"].orEmpty().groupBy{it.data.str("moment_id")}
        val likesByMoment=groups["daily_likes"].orEmpty().groupBy{it.data.str("moment_id")}
        val children=groups["daily_comments"].orEmpty()+groups["daily_likes"].orEmpty()
        for(child in children){
            val p=requireNotNull(parents[child.data.str("moment_id")]){"日常评论或点赞缺少原动态。"}
            require(child.record.dependencies==listOf("daily/"+p.record.id))
        }
        val moments=groups["daily_moments"].orEmpty().map { row->
            val d=row.data;val id=d.str("id")
            require(d.str("status")=="published"){"暂不恢复未发布动态。"}
            val comments=commentsByMoment[id].orEmpty().sortedWith(compareBy({it.data.getValue("created_at").jsonPrimitive.long},{it.data.str("id")})).map { child->
                val c=child.data
                require(c["author"]!=JsonNull&&c["created_at"]!=JsonNull)
                val usage=if(c["usage_json"]==JsonNull)JsonNull else Json.parseToJsonElement(c.str("usage_json")).jsonObject.also { u->
                    require(u.keys.all { it in setOf("prompt_tokens","completion_tokens","reasoning_tokens","cached_tokens","total_tokens") }&&u.values.all { it is JsonPrimitive&&!it.isString&&it.long>=0 })
                }
                JsonObject(c.filterKeys { it !in setOf("moment_id","usage_json") }+mapOf("author" to role(c.getValue("author")),"created_at" to time(c.getValue("created_at")),"usage" to usage))
            }
            val likes=likesByMoment[id].orEmpty().map{child->
                val c=child.data;require(c["created_at"]!=JsonNull)
                JsonObject(mapOf("actor" to role(c.getValue("actor")),"created_at" to time(c.getValue("created_at"))))
            }.sortedBy { it.str("actor") }
            require(likes.map{it.str("actor")}.distinct().size==likes.size)
            JsonObject(common(row)+mapOf("status" to d.getValue("status"),"reason" to d.getValue("reason"),"published_at" to time(d.getValue("published_at")),
                "comments" to JsonArray(comments),"likes" to JsonArray(likes),"like_count" to JsonPrimitive(likes.size),"liked" to JsonPrimitive(likes.any{it.str("actor")=="owner"})))
        }
        val diaries=groups["daily_diaries"].orEmpty().map{row->
            val d=row.data
            require(listOf("weather","mood").all { d[it]!=JsonNull&&d.str(it).isNotEmpty() }){"旧日记缺少原始天气或心情，未填造。"}
            val tags=Json.parseToJsonElement(d.str("tags_json")).jsonArray
            require(tags.all { it is JsonPrimitive&&it.isString })
            JsonObject(common(row)+mapOf("weather" to d.getValue("weather"),"mood" to d.getValue("mood"),"tags" to tags))
        }
        val profiles=groups["daily_profile"].orEmpty()
        require(profiles.size<=1)
        val profile=profiles.singleOrNull()?.let { row->
            val d=row.data;require(d.str("id")=="owner"&&row.record.dependencies.isEmpty()&&d["updated_at"]!=JsonNull)
            JsonObject(profileFields.map { (from,to)->to to d.getValue(from) }.toMap()+mapOf("moment_cover_dataurl" to d.getValue("moment_cover_dataurl"),"updated_at" to time(d.getValue("updated_at"))))
        }?:JsonNull
        return Result(JsonArray(moments),JsonArray(diaries),profile)
    }
}
