package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant

/** The same canonical current and immutable historical rows used by cloud V2.
 * A history row is attached to its exact assistant variant, never the latest reply. */
internal class LocalSoilStore(private val store:LocalPersistence) {
    data class Rows(val current:List<JsonObject>,val history:List<JsonObject>)
    fun read():Rows {
        val raw=store.get(KEY)
        if(raw.isEmpty())return Rows(emptyList(),emptyList())
        val data=Json.parseToJsonElement(raw).jsonObject
        require(data.keys==setOf("current","history"))
        return Rows(data.getValue("current").jsonArray.map{it.jsonObject},data.getValue("history").jsonArray.map{it.jsonObject}).also(::validate)
    }
    fun write(rows:Rows){
        validate(rows)
        store.put(KEY,buildJsonObject{put("current",JsonArray(rows.current));put("history",JsonArray(rows.history))}.toString())
        require(read()==rows)
    }
    fun current(cid:String)=read().current.find{it.str("conversation_id")==cid}
    fun response(cid:String):JsonObject{
        val rows=read();val r=rows.current.find{it.str("conversation_id")==cid}
        return buildJsonObject{
            put("ok",true)
            put("soil",r?.let{wire(it)}?:buildJsonObject{put("conversation_id",cid);put("auto_refresh_enabled",false)})
            val history=rows.history.filter{it.str("conversation_id")==cid}.sortedByDescending{it.getValue("created_at").jsonPrimitive.long}
            put("history",JsonArray(history.map(::wire)));put("history_truncated",false)
        }
    }
    fun patch(cid:String,request:JsonObject):JsonObject{
        require(request.isNotEmpty()&&request.keys.all{it in setOf("current_text","afterthoughts","manual_locked","auto_refresh_enabled")})
        val rows=read();val now=System.currentTimeMillis()
        val old=rows.current.find{it.str("conversation_id")==cid}
        val initial=old?:buildJsonObject{
            put("conversation_id",cid);put("current_text","");put("do_not_repeat","")
            for(k in arrayFields)put(k,"[]");for(k in objectFields)put(k,"null")
            put("manual_locked",0);put("auto_refresh_enabled",0);put("organized_through_turn_id","");put("source_assistant_id","")
            put("revision",1);put("created_at",now);put("updated_at",now)
            put("actor","owner");put("surface","native_manual");put("display_author","屋主");put("symbol","")
            for(k in listOf("model_label","model_nickname","source_turn_id","tool_call_id"))put(k,JsonNull)
            put("source_conversation_id",cid)
        }
        val changes=buildJsonObject{
            if("current_text" in request){val text=request.str("current_text");require(text.length<=4000);put("current_text",text)}
            if("afterthoughts" in request){val values=request.getValue("afterthoughts").jsonArray;require(values.size<=7&&values.all{it is JsonPrimitive&&it.isString&&it.content.length<=2000});put("afterthoughts_json",values.toString())}
            for(k in listOf("manual_locked","auto_refresh_enabled"))request[k]?.let{put(k,if(it.jsonPrimitive.boolean)1 else 0)}
            if(("current_text" in request||"afterthoughts" in request)&&"manual_locked" !in request)put("manual_locked",1)
            put("revision",Math.addExact(initial.getValue("revision").jsonPrimitive.int,1));put("updated_at",now)
        }
        val row=JsonObject(initial+changes)
        write(rows.copy(current=rows.current.filterNot{it.str("conversation_id")==cid}+row))
        return response(cid)
    }
    companion object{
        const val KEY="local.soil.records.v2"
        val modules=setOf("thinking_soil","thinking_soil_history")
        private val currentFields="conversation_id,current_text,hand_seeds_json,do_not_repeat,pocket_candidates_json,afterthoughts_json,memory_candidates_json,seed_candidates_json,user_portrait_candidate_json,self_portrait_candidate_json,manual_locked,auto_refresh_enabled,organized_through_turn_id,source_assistant_id,tool_call_ids_json,revision,created_at,updated_at,actor,surface,model_label,model_nickname,symbol,display_author,source_conversation_id,source_turn_id,tool_call_id".split(",").toSet()
        private val historyFields="conversation_id,turn_id,assistant_message_id,current_text,afterthoughts_json,revision,model_label,display_author,created_at".split(",").toSet()
        private val arrayFields=setOf("hand_seeds_json","pocket_candidates_json","afterthoughts_json","memory_candidates_json","seed_candidates_json","tool_call_ids_json")
        private val objectFields=setOf("user_portrait_candidate_json","self_portrait_candidate_json")
        private val id=Regex("[A-Za-z0-9_.:-]{1,160}")
        fun JsonObject.str(k:String):String {val v=getValue(k);require(v is JsonPrimitive&&v.isString);return v.content}
        fun identity(module:String,row:JsonObject):String{
            val parts=if(module=="thinking_soil_history")listOf(row.getValue("conversation_id"),row.getValue("assistant_message_id")) else listOf(row.getValue("conversation_id"))
            return module+":"+ArchiveV2Chunks.digest(JsonArray(parts).toString().encodeToByteArray())
        }
        fun validateRow(v:JsonObject,history:Boolean){
            require(v.keys==if(history)historyFields else currentFields)
            require(id.matches(v.str("conversation_id")))
            require(v.str("current_text").length<=12000)
            for(k in listOf("revision","created_at")+(if(history)emptyList()else listOf("updated_at"))){
                val n=v.getValue(k).jsonPrimitive;require(!n.isString&&n.long>=0)
            }
            require(v.getValue("revision").jsonPrimitive.long in 1..Int.MAX_VALUE.toLong())
            for(k in v.keys.filter{it.endsWith("_json")}){
                val parsed=Json.parseToJsonElement(v.str(k))
                if(k in objectFields)require(parsed==JsonNull||parsed is JsonObject)else require(parsed is JsonArray)
            }
            if(history){require(id.matches(v.str("turn_id"))&&id.matches(v.str("assistant_message_id")));v.str("model_label");v.str("display_author")}
            else {
                for(k in listOf("manual_locked","auto_refresh_enabled")){val n=v.getValue(k).jsonPrimitive;require(!n.isString&&n.int in 0..1)}
                for(k in listOf("do_not_repeat","organized_through_turn_id","source_assistant_id","actor","surface","symbol","display_author"))v.str(k)
                for(k in listOf("model_label","model_nickname","source_conversation_id","source_turn_id","tool_call_id"))if(v[k]!=JsonNull)v.str(k)
            }
            val after=Json.parseToJsonElement(v.str("afterthoughts_json")).jsonArray
            require(after.size<=7&&after.all{it is JsonPrimitive&&it.isString&&it.content.length<=2000})
        }
        fun validate(rows:Rows){
            rows.current.forEach{validateRow(it,false)};rows.history.forEach{validateRow(it,true)}
            require(rows.current.map{it.str("conversation_id")}.distinct().size==rows.current.size)
            require(rows.history.map{it.str("conversation_id") to it.str("assistant_message_id")}.distinct().size==rows.history.size)
        }
        fun wire(row:JsonObject):JsonObject=buildJsonObject{
            for((k,v) in row)when{
                k.endsWith("_json")->put(k.removeSuffix("_json"),Json.parseToJsonElement(v.jsonPrimitive.content))
                k in setOf("created_at","updated_at")->put(k,Instant.ofEpochMilli(v.jsonPrimitive.long).toString())
                k in setOf("manual_locked","auto_refresh_enabled")->put(k,v.jsonPrimitive.int==1)
                else->put(k,v)
            }
            put("organized_by_model",row["model_label"]?.jsonPrimitive?.contentOrNull.orEmpty())
        }
    }
}
