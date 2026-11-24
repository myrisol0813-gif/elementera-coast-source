package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** One canonical document and its evidence per portrait. No seeded private content. */
internal class LocalPortraitStore(private val store:LocalPersistence) {
    data class Document(val root:JsonObject,val candidates:List<JsonObject>,val revisions:List<JsonObject>)
    private fun key(module:String):String {require(module in modules);return "local.portrait."+module+".v2"}
    fun read(module:String):Document? {
        val raw=store.get(key(module));if(raw.isEmpty())return null
        val v=Json.parseToJsonElement(raw).jsonObject
        require(v.keys==setOf("root","candidates","revisions"))
        return Document(v.getValue("root").jsonObject,v.getValue("candidates").jsonArray.map{it.jsonObject},v.getValue("revisions").jsonArray.map{it.jsonObject}).also(::validate)
    }
    fun write(module:String,d:Document){
        validate(d)
        store.put(key(module),buildJsonObject{put("root",d.root);put("candidates",JsonArray(d.candidates));put("revisions",JsonArray(d.revisions))}.toString())
        require(read(module)==d)
    }
    private fun blank(now:Long)=Document(buildJsonObject{put("id","global");put("body","");put("write_enabled",1);put("revision",1);put("created_at",now);put("updated_at",now)},emptyList(),emptyList())
    fun body(module:String)=read(module)?.root?.str("body").orEmpty()
    fun response(module:String):JsonObject{
        val d=read(module)
        val root=d?.root?.let{wire(it)}?:buildJsonObject{put("body","");put("revision",1);put("write_enabled",true)}
        return buildJsonObject{
            put("ok",true);put(if(module=="user_portrait")"portrait" else "excerpt",JsonObject(root+("write_guidance" to JsonPrimitive("仅在有值得长期保留的认识时提出完整正文候选，由屋主确认。")))))
            put("candidates",JsonArray(d?.candidates.orEmpty().sortedByDescending{it.getValue("created_at").jsonPrimitive.long}.map(::wire)))
            put("revisions",JsonArray(d?.revisions.orEmpty().sortedByDescending{it.getValue("revision").jsonPrimitive.int}.map(::wire)))
        }
    }
    fun patch(module:String,request:JsonObject):JsonObject{
        val now=System.currentTimeMillis();val d=read(module)?:blank(now)
        val next=if(request.keys==setOf("write_enabled")){
            val enabled=request.getValue("write_enabled").jsonPrimitive.boolean
            d.copy(root=JsonObject(d.root+mapOf("write_enabled" to JsonPrimitive(if(enabled)1 else 0),"updated_at" to JsonPrimitive(now))))
        }else{
            require(request.keys==setOf("action","expected_revision")&&request.str("action")=="clear")
            require(request.getValue("expected_revision").jsonPrimitive.int==d.root.getValue("revision").jsonPrimitive.int){"画像已更新，请刷新后确认。"}
            if(d.root.str("body").isEmpty())return response(module)
            revised(d,"","clear","user","用户主动清空正式正文",null,now)
        }
        write(module,next);return response(module)
    }
    fun confirm(module:String,id:String,request:RemoteGlobalExcerptConfirmRequest):JsonObject{
        require(request.action=="confirm"&&request.operator.length<=40)
        val d=requireNotNull(read(module));val c=requireNotNull(d.candidates.find{it.str("id")==id}){"候选不存在。"}
        val after=(request.editedBody?:c.str("proposed_body")).trim();require(after.isNotEmpty()&&after.length<=240000)
        val next=revised(d,after,if(request.editedBody==null)"confirm" else "edited_confirm",request.operator,c.str("reason"),c,System.currentTimeMillis())
        write(module,next.copy(candidates=next.candidates.filterNot{it.str("id")==id}));return response(module)
    }
    fun discard(module:String,id:String):Boolean{
        val d=read(module)?:return false
        val kept=d.candidates.filterNot{it.str("id")==id}
        if(kept.size==d.candidates.size)return false
        write(module,d.copy(candidates=kept));return true
    }
    private fun revised(d:Document,body:String,mode:String,operator:String,reason:String,c:JsonObject?,now:Long):Document{
        val revision=Math.addExact(d.root.getValue("revision").jsonPrimitive.int,1)
        val r=buildJsonObject{
            put("id",UUID.randomUUID().toString());put("revision",revision);put("before_body",d.root.str("body"));put("after_body",body)
            for(k in listOf("source_conversation_id","source_message_id"))put(k,c?.get(k)?:JsonNull)
            put("model_reason",reason);put("confirmation_mode",mode);put("operator",operator);put("created_at",now)
        }
        return d.copy(root=JsonObject(d.root+mapOf("body" to JsonPrimitive(body),"revision" to JsonPrimitive(revision),"updated_at" to JsonPrimitive(now))),revisions=d.revisions+r)
    }
    companion object{
        val modules=setOf("user_portrait","self_portrait")
        private val rootKeys="id,body,write_enabled,revision,created_at,updated_at".split(",").toSet()
        private val candidateKeys="id,proposed_body,change_kind,reason,source_conversation_id,source_message_id,source_model,created_at".split(",").toSet()
        private val revisionKeys="id,revision,before_body,after_body,source_conversation_id,source_message_id,model_reason,confirmation_mode,operator,created_at".split(",").toSet()
        private val safeId=Regex("[A-Za-z0-9_.:-]{1,160}")
        private fun JsonObject.str(k:String):String {val x=getValue(k);require(x is JsonPrimitive&&x.isString);return x.content}
        private fun wire(v:JsonObject)=JsonObject(v.mapValues{(k,x)->when(k){
            "created_at","updated_at"->JsonPrimitive(Instant.ofEpochMilli(x.jsonPrimitive.long).toString())
            "write_enabled"->JsonPrimitive(x.jsonPrimitive.int==1)
            else->x
        }})
        fun validate(d:Document){
            fun text(v:JsonObject,k:String,n:Int){require(v.str(k).length<=n)}
            fun num(v:JsonObject,k:String):Long{val x=v.getValue(k).jsonPrimitive;require(!x.isString&&x.long>=0);return x.long}
            fun common(v:JsonObject){require(safeId.matches(v.str("id")));num(v,"created_at")}
            fun source(v:JsonObject){for(k in listOf("source_conversation_id","source_message_id"))require(v[k]==JsonNull||safeId.matches(v.str(k)))}
            val r=d.root;require(r.keys==rootKeys&&r.str("id")=="global");common(r);text(r,"body",240000);num(r,"updated_at")
            require(num(r,"write_enabled") in 0L..1L);val rev=num(r,"revision");require(rev in 1..Int.MAX_VALUE.toLong())
            require(d.candidates.map{it.str("id")}.distinct().size==d.candidates.size&&d.revisions.map{it.str("id")}.distinct().size==d.revisions.size)
            for(c in d.candidates){require(c.keys==candidateKeys);common(c);source(c);text(c,"proposed_body",240000);require(c.str("proposed_body").isNotBlank());text(c,"change_kind",40);text(c,"reason",4000);text(c,"source_model",200)}
            val history=d.revisions.sortedBy{num(it,"revision")}
            require(history.size.toLong()==rev-1){"画像修订史不完整。"}
            for((i,h) in history.withIndex()){
                require(h.keys==revisionKeys);common(h);source(h);require(num(h,"revision")==i+2L)
                text(h,"before_body",240000);text(h,"after_body",240000);text(h,"model_reason",4000);text(h,"operator",40)
                require(h.str("confirmation_mode") in setOf("confirm","edited_confirm","clear"))
                require(i==0||h.str("before_body")==history[i-1].str("after_body")){"画像修订链断裂。"}
            }
            require(history.isEmpty()||history.last().str("after_body")==r.str("body")){"画像正文与修订史不一致。"}
        }
    }
}
