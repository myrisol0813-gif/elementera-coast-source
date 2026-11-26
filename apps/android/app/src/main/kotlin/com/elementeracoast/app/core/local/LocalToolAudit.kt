package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*

/** Immutable, owner-only historical audit metadata. No arguments, results,
 * error text, external connector data or execution hooks are stored here. */
internal class LocalToolAudit(private val store:LocalPersistence){
    fun read():List<JsonObject>{
        val raw=store.get(KEY)
        return if(raw.isEmpty())emptyList() else Json.parseToJsonElement(raw).jsonArray.map{it.jsonObject}.also(::validate)
    }
    fun write(rows:List<JsonObject>){
        validate(rows);store.put(KEY,JsonArray(rows).toString());require(read()==rows)
    }
    companion object{
        const val KEY="local.tool.audit.v2"
        val fields=setOf("id","tool_key","actor","room_scope","conversation_id","status","created_at","finished_at")
        private val keys=setOf("web.independent_search","web.independent_read","coast.status","radio.list","lighthouse.list","daily.create_moment","daily.create_diary","daily.moment_comment","daily.moment_like","dogtalk.read","dogtalk.save","cross_window.search","cross_window.keyword_search","cross_window.read_messages","cross_window.read_recent","memory.global_excerpt_propose","memory.user_portrait_propose","vault.search","vault.read","memory.search","memory.write_candidate","memory.authorized_search","radio.send","lighthouse.write_letter","daily.moments.list","daily.diaries.list","calendar.list","calendar.create","calendar.update","calendar.delete","voice.create","library.books","library.read","library.notes","library.write","worldbook.list","worldbook.create","worldbook.update")
        private val actors=setOf("api_model_partner","native_model_partner","official_mcp","owner","model_partner","api","mcp","assistant")
        private val rooms=setOf("main_chat","main","conversation","radio","lighthouse","daily","official_mcp")
        private val safeId=Regex("[A-Za-z0-9_.:-]{1,160}")
        private fun JsonObject.str(k:String):String {val x=getValue(k);require(x is JsonPrimitive&&x.isString);return x.content}
        fun validateRow(v:JsonObject){
            require(v.keys==fields&&safeId.matches(v.str("id"))&&safeId.matches(v.str("conversation_id"))&&v.str("tool_key") in keys&&v.str("actor") in actors&&v.str("room_scope") in rooms&&v.str("status") in setOf("success","error")){"工具归档含未授权或不兼容字段。"}
            val created=v.getValue("created_at").jsonPrimitive;val finished=v.getValue("finished_at").jsonPrimitive
            require(!created.isString&&!finished.isString&&created.long>=0&&finished.long>=created.long)
        }
        fun validate(rows:List<JsonObject>){rows.forEach(::validateRow);require(rows.map{it.str("id")}.distinct().size==rows.size)}
    }
}
