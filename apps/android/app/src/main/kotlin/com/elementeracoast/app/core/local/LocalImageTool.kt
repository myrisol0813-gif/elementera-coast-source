package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*

/** One turn, one selected provider, private pixels never serialized as a tool output. */
internal class LocalImageTool(
    private val store:LocalPersistence, private val resolveProvider:(String)->LocalProviderConfig?,
    private val cid:String,private val tid:String,private val uid:String,val messageId:String,
    private val selected:String,private val vision:Boolean?,private val sequenceId:String?=null
){
    private var attempted=false
    var saved=false; private set
    private var continuation:JsonObject?=null
    fun takeContinuation():List<JsonObject> = listOfNotNull(continuation).also{continuation=null}
    fun sameTurn(before:RemoteTurn,after:RemoteTurn):Boolean {
        fun withoutTarget(t:RemoteTurn)=t.copy(assistant=t.assistant.copy(variantsByUserVariant=t.assistant.variantsByUserVariant.mapValues{(_,v)->v.filterNot{it.id==messageId}}))
        return withoutTarget(before)==withoutTarget(after)
    }
    fun execute(input:JsonObject):JsonObject{
        require(input.keys==setOf("prompt"))
        val prompt=input.getValue("prompt").jsonPrimitive.let{require(it.isString);it.content.trim()}
        require(prompt.length in 1..4000)
        if(attempted)return buildJsonObject{put("ok",false);put("code","image_already_reserved");put("message","本轮已尝试绘图，不自动重试。")}
        attempted=true
        val config=resolveProvider(selected)
        val result=runLocalManualImageGeneration(store,config,buildJsonObject{
            put("conversation_id",cid);put("turn_id",tid);put("user_variant_id",uid);put("message_id",messageId);put("prompt",prompt)
        },modelTool=true,visionSupported=vision,expectedModel=selected,onSaved={r->saved=true;continuation=r.readback.continuationMessage},sequenceId=sequenceId)
        val a=result.getValue("attachment").jsonObject
        return buildJsonObject{put("ok",true);put("status","saved");put("attachment",JsonObject(a.filterKeys{it in setOf("id","type","mime","size")}));put("readback",result.getValue("readback"))}
    }
}
