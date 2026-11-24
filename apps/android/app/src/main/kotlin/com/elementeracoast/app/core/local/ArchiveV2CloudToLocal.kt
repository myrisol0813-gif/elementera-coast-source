package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import java.time.Instant

/** Only cloud rows that the current local store can represent without loss.
 * A related media/soil/collection row must not silently disappear. */
internal object ArchiveV2CloudToLocal {
    val supportedModules=setOf("chat","calendar")
    private fun JsonObject.string(key:String)=getValue(key).jsonPrimitive.content
    private fun iso(v:JsonElement):JsonElement=if(v==JsonNull)JsonNull else JsonPrimitive(Instant.ofEpochMilli(v.jsonPrimitive.long).toString())
    private fun verifyKeys(v:JsonObject,keys:Set<String>){require(v.keys==keys){"云端记录字段不兼容，未恢复。"}}
    fun convert(manifest:ArchiveV2Manifest,stage:ArchiveV2Stage,selection:Set<String>):ByteArray {
        ArchiveV2Manifests.validate(manifest)
        require(manifest.workspace=="backend"&&manifest.applicationId in setOf("com.elementeracoast.app","com.elementeracoast.source")&&selection.isNotEmpty()&&supportedModules.containsAll(selection))
        require(selection.all { k->manifest.modules.any { it.module==k&&it.coverage!="unavailable" } })
        val objects=manifest.objects.associateBy { it.objectSha256 }
        val chosen=manifest.records.filter { it.module in selection }
        require(chosen.sumOf { objects.getValue(it.recordObject).size }<=CoastTransferCodec.MAX_BYTES)
        val chats=mutableListOf<JsonElement>();val calendar=mutableListOf<JsonElement>()
        for(r in chosen){
            require(r.mediaObjects.isEmpty()&&r.dependencies.isEmpty()){"此记录关联目标本机暂不能恢复的资料。"}
            if(r.module=="chat")require(manifest.records.none { it.module !in selection&&"chat/"+r.id in it.dependencies }){"窗口有关联原件、思维壤或其他资料，本机暂不能完整恢复。"}
            val d=objects.getValue(r.recordObject)
            val raw=Json.parseToJsonElement(stage.verify(d,CoastTransferCodec.MAX_BYTES.toLong()).readBytes().decodeToString(throwOnInvalidSequence=true)).jsonObject
            verifyKeys(raw,setOf("kind","data"));require(raw.string("kind")==r.module)
            val data=raw.getValue("data").jsonObject
            when(r.module){
                "chat"->{
                    verifyKeys(data,setOf("conversation","history_json","history_updated_at"))
                    val c=data.getValue("conversation").jsonObject
                    verifyKeys(c,setOf("id","title","room_type","created_at","updated_at","deleted_at","title_manual","title_generated_at","title_model_id","source","source_window_id"))
                    require(c.string("id")==r.id&&c["deleted_at"]==JsonNull)
                    val fields=c.toMutableMap()
                    for(k in listOf("created_at","updated_at","title_generated_at"))fields[k]=iso(c.getValue(k))
                    val flag=c.getValue("title_manual").jsonPrimitive.int
                    require(flag in 0..1);fields["title_manual"]=JsonPrimitive(flag==1)
                    val h=Json.parseToJsonElement(data.string("history_json")).jsonObject
                    require(h["conversation_id"]==null||h["conversation_id"]==JsonNull||h.string("conversation_id")==r.id)
                    val historyTime=Instant.parse(h.string("updated_at")).toEpochMilli()
                    require(historyTime==data.getValue("history_updated_at").jsonPrimitive.long){"历史时间字段不能无损对应。"}
                    chats.add(buildJsonObject { put("conversation",JsonObject(fields));put("history",JsonObject(h+("conversation_id" to JsonPrimitive(r.id)))) })
                }
                "calendar"->{
                    verifyKeys(data,setOf("id","day","kind","title","body","recurrence","author","source","conversation_id","source_turn_id","tool_call_id","model_label","created_at","updated_at","anniversary_start_day","anniversary_mode","anniversary_target_days","anniversary_pinned"))
                    require(data.string("id")==r.id&&listOf("conversation_id","source_turn_id").all { data[it]==JsonNull }){"本机日历不能保留这条记录的来源字段。"}
                    require(data.string("author") in setOf("owner","assistant"))
                    val pin=data.getValue("anniversary_pinned").jsonPrimitive.int;require(pin in 0..1)
                    val row=buildJsonObject {
                        for(k in listOf("id","day","kind","title","body","recurrence","author","source","created_at","updated_at"))put(k,data.getValue(k))
                        for(k in listOf("model_label","tool_call_id"))data.getValue(k).takeIf { it!=JsonNull }?.let { put(k,it) }
                        put("occurrence_day",data.getValue("day"))
                        if(data["anniversary_mode"]!=JsonNull)putJsonObject("anniversary"){
                            put("startDay",data.getValue("anniversary_start_day"));put("mode",data.getValue("anniversary_mode"));put("targetDays",data.getValue("anniversary_target_days"));put("pinned",pin==1)
                        }else require(data["anniversary_start_day"]==JsonNull&&data["anniversary_target_days"]==JsonNull&&pin==0)
                    }
                    calendar.add(row)
                }
            }
        }
        return CoastTransferCodec.encode(buildJsonObject {
            put("applicationId",manifest.applicationId);put("workspace","backend");put("exportedAt",manifest.exportedAt)
            put("includedModules",JsonArray(selection.sorted().map(::JsonPrimitive)))
            put("conversations",JsonArray(chats));put("calendar",JsonArray(calendar));put("moments",JsonArray(emptyList()));put("diaries",JsonArray(emptyList()));put("profile",JsonNull);put("dailyProfile",JsonNull)
        })
    }
}
