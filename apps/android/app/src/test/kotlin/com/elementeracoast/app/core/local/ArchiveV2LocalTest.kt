package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteTurn
import com.elementeracoast.app.core.remote.RemoteUserBranch
import com.elementeracoast.app.core.remote.RemoteVariant
import com.elementeracoast.app.core.remote.RemoteProfile
import com.elementeracoast.app.core.remote.RemoteCacheStore
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class ArchiveV2LocalTest {
    @Test fun localZipRoundtripUsesRealAtomicRestore() {
        val root=Files.createTempDirectory("coast-local-v2").toFile()
        try {
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence()
            val profile=RemoteProfile(currentChatModel="model-fixture")
            RemoteCacheStore(source).putProfile(profile)
            val file=File(root,"local.zip")
            val app="com.elementeracoast.source"
            val manifest=ArchiveV2Local.export(source,app,file)
            val stage=ArchiveV2Stage(File(root,"stage"),"local")
            assertEquals(manifest,ArchiveV2ZipReader.stage(file,stage))
            val selection=setOf("model_profile")
            assertEquals(1,ArchiveV2Local.restore(manifest,stage,selection,app,target,false).counts.getValue("model_profile").ready)
            assertNull(RemoteCacheStore(target).profile())
            ArchiveV2Local.restore(manifest,stage,selection,app,target,true)
            assertEquals(profile,RemoteCacheStore(target).profile())
            assertTrue(manifest.modules.any { it.module=="attachments"&&it.coverage=="partial"&&it.count==0 })
        }finally{root.deleteRecursively()}
    }

    @Test fun detachedRoomSnapshotsKeepOriginalBytesAcrossLocalZip(){
        val root=Files.createTempDirectory("coast-detached-dogtalk").toFile()
        try{
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence()
            val store=LocalDogtalkStore(source)
            store.save(buildJsonObject{put("room_scope","radio");put("body","current draft");put("read_mode","keep_private")})
            store.save(buildJsonObject{put("room_scope","lighthouse");put("body","other current draft");put("read_mode","keep_private")})
            val parents=store.read()
            val snapshots=parents.map{parent->
                val room=parent.data.getValue("room_scope").jsonPrimitive.content
                LocalDogtalkStore.Row("dogtalk_snapshots",JsonObject(parent.data.filterKeys{it !in setOf("type","status","source","updated_at","archived_at","last_read_at")}+buildJsonObject{
                    put("id","snapshot-"+room);put("dogtalk_id",parent.id);put("source_type",if(room=="radio")"radio_message" else "lighthouse_letter")
                    put("source_id","legacy-"+room);put("body","historical "+room)
                }))
            }
            store.write(parents+snapshots)
            val app="com.elementeracoast.source";val modules=LocalDogtalkStore.modules
            val file=File(root,"source.zip");val manifest=ArchiveV2Local.export(source,app,file)
            val stage=ArchiveV2Stage(File(root,"stage"),"original")
            assertEquals(manifest,ArchiveV2ZipReader.stage(file,stage))
            // These two record types have identical wire forms in cloud and local ZIPs.
            val cloud=manifest.copy(workspace="backend")
            val preview=ArchiveV2Local.restore(cloud,stage,modules,app,target,false)
            assertEquals(2,preview.counts.getValue("dogtalk_snapshots").archivedOnly)
            assertTrue(LocalDogtalkStore(target).read().isEmpty())
            ArchiveV2Local.restore(cloud,stage,modules,app,target,true)
            assertEquals(store.read().associateBy{it.id},LocalDogtalkStore(target).read().associateBy{it.id})
            assertEquals("current draft",LocalDogtalkStore(target).public("radio",null)["body"]!!.jsonPrimitive.content)
            assertEquals("keep_private",LocalDogtalkStore(target).public("radio",null)["read_mode"]!!.jsonPrimitive.content)
            val again=File(root,"again.zip");val m2=ArchiveV2Local.export(target,app,again)
            val s2=ArchiveV2Stage(File(root,"stage2"),"again");assertEquals(m2,ArchiveV2ZipReader.stage(again,s2))
            val finalStore=MemoryLocalPersistence();ArchiveV2Local.restore(m2,s2,modules,app,finalStore,true)
            assertEquals(store.read().associateBy{it.id},LocalDogtalkStore(finalStore).read().associateBy{it.id})
            val invalidHistory=RemoteHistory(conversationId="live",turns=listOf(RemoteTurn("turn-live",user=RemoteUserBranch(variants=listOf(RemoteVariant("v",dogtalkSnapshotId=snapshots.first().id))))))
            val rejected=runCatching{ArchiveV2Dogtalk.apply(parents+snapshots,modules,MemoryLocalPersistence(),mapOf("live" to invalidHistory),emptySet(),false)}
            assertTrue(rejected.isFailure)
        }finally{root.deleteRecursively()}
    }
    @Test fun replyGroupsAndTheirDeskReceiptsRoundTripWithoutTaskReplay(){
        val root=Files.createTempDirectory("coast-reply-v2").toFile()
        try{
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence()
            val cache=RemoteCacheStore(source)
            cache.putConversations(listOf(com.elementeracoast.app.core.remote.RemoteConversation("cid","group","main")))
            val cfg=com.elementeracoast.app.core.model.ConversationContextSettings(replySequenceEnabled=true,replySequenceMaxMessages=4,replySequenceToolBudget=0,replySequenceTokenBudget=17000)
            val a=com.elementeracoast.app.core.remote.RemoteVariant("a0","first",replySequence=com.elementeracoast.app.core.remote.RemoteReplySequence("seq",0),
                deskSlip=com.elementeracoast.app.core.remote.RemoteDeskSlip(summary="first desk"),archiveRetainedDeskSlip=true)
            val b=a.copy(id="a1",content="second",replySequence=com.elementeracoast.app.core.remote.RemoteReplySequence("seq",1),
                deskSlip=com.elementeracoast.app.core.remote.RemoteDeskSlip(summary="second desk",replySequencePrevious=listOf(com.elementeracoast.app.core.remote.RemoteDeskSequenceMessage("a0","first"))))
            val t=RemoteTurn("t",user=RemoteUserBranch(variants=listOf(RemoteVariant("u","hello"))),assistant=com.elementeracoast.app.core.remote.RemoteAssistantBranches(mapOf("0" to 1),mapOf("0" to listOf(a,b))))
            cache.putHistory("cid",RemoteHistory(conversationId="cid",contextSettings=cfg,turns=listOf(t)))
            val file=File(root,"group.zip");val app="com.elementeracoast.source";val manifest=ArchiveV2Local.export(source,app,file)
            val stage=ArchiveV2Stage(File(root,"stage"),"group")
            assertEquals(manifest,ArchiveV2ZipReader.stage(file,stage))
            ArchiveV2Local.restore(manifest,stage,setOf("chat"),app,target,true)
            val restored=RemoteCacheStore(target).history("cid")!!
            assertEquals(cfg,restored.contextSettings)
            val group=restored.turns.single().assistant.variantsByUserVariant.getValue("0")
            assertEquals(listOf("a0","a1"),group.map{it.id})
            assertEquals(listOf(0,1),group.map{it.replySequence!!.index})
            assertTrue(group.all{it.archiveRetainedDeskSlip})
            assertEquals("first desk",group.first().deskSlip!!.summary)
            assertEquals("a0",group.last().deskSlip!!.replySequencePrevious.single().messageId)
            assertFalse(LocalReplyRunStore(target).active("cid"))
        }finally{root.deleteRecursively()}
    }

    @Test fun archiveRejectsActiveReplyReservationAndKeepsCompletedHistory(){
        val root=Files.createTempDirectory("coast-active-v2").toFile()
        try{
            val source=MemoryLocalPersistence();val cache=RemoteCacheStore(source)
            cache.putConversations(listOf(com.elementeracoast.app.core.remote.RemoteConversation("cid","group","main")))
            val base=com.elementeracoast.app.feature.chat.ChatSyncMapper.appendUser(RemoteHistory(conversationId="cid",contextSettings=com.elementeracoast.app.core.model.ConversationContextSettings(replySequenceEnabled=true)),"question")
            cache.putHistory("cid",base.history)
            val req=com.elementeracoast.app.core.network.RemoteReplyRunRequest("cid",base.turnId,base.history.turns.single().user.variants.single().id,"seq","model",com.elementeracoast.app.core.network.RemoteReplyRunBudget(1,1,2000),"2026-11-26","2026-11-26 12:00",JsonObject(emptyMap()))
            val ledger=LocalReplyRunStore(source)
            assertTrue(ledger.acquire(req));assertTrue(ledger.reserve("cid","seq","a0",0))
            assertNotNull(ledger.claim("cid","seq","a0"));assertTrue(ledger.reserveMedia("cid","seq","a0","model",false))
            val file=File(root,"active.zip");val app="com.elementeracoast.source"
            assertTrue(runCatching{ArchiveV2Local.export(source,app,file)}.isFailure)
            assertFalse(file.exists())
            assertTrue(ledger.settle("cid","seq","cancelled"))
            val manifest=ArchiveV2Local.export(source,app,file)
            val stage=ArchiveV2Stage(File(root,"stage"),"active")
            assertEquals(manifest,ArchiveV2ZipReader.stage(file,stage))
            val target=MemoryLocalPersistence()
            ArchiveV2Local.restore(manifest,stage,setOf("chat"),app,target,true)
            assertFalse(LocalReplyRunStore(target).active("cid"))
            assertTrue(RemoteCacheStore(target).history("cid")!!.turns.single().assistant.variantsByUserVariant.values.flatten().isEmpty())
        }finally{root.deleteRecursively()}
    }

    @Test fun explicitDeviceSettingsArchiveKeepsBudgetZeroAndDoesNotMoveCredentials(){
        val root=Files.createTempDirectory("coast-device-settings").toFile()
        try{
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence()
            source.put("wolf.replySequenceMaxMessages","7");source.put("wolf.replySequenceToolBudget","0")
            source.put("wolf.replySequenceTokenBudget","95000");source.put("wolf.toolCallLimit","41")
            source.put("wolf.contextBudget","0");source.put("provider.secret","not-exported")
            target.put("wolf.replySequenceTokenBudget","12000");target.put("provider.secret","target-secret")
            val app="com.elementeracoast.source";val file=File(root,"device.zip")
            val m=ArchiveV2Local.export(source,app,file,root);val stage=ArchiveV2Stage(File(root,"stage"),"device")
            assertEquals(m,ArchiveV2ZipReader.stage(file,stage))
            assertEquals(1,ArchiveV2Local.restore(m,stage,setOf("appearance"),app,target,false,root).counts.getValue("appearance").ready)
            assertEquals("12000",target.get("wolf.replySequenceTokenBudget"))
            ArchiveV2Local.restore(m,stage,setOf("appearance"),app,target,true,root)
            val b=com.elementeracoast.app.feature.wolf.WolfStore(target).state.value.basic
            assertEquals(7,b.replySequenceMaxMessages);assertEquals(0,b.replySequenceToolBudget)
            assertEquals(95000,b.replySequenceTokenBudget);assertEquals(41,b.toolCallLimit);assertEquals(0,b.contextBudget)
            assertEquals("target-secret",target.get("provider.secret"))
            val legacy=ArchiveV2Appearance.Snapshot(JsonObject(emptyMap()),emptyList())
            ArchiveV2Appearance.apply(legacy,target,root,true)
            assertEquals("95000",target.get("wolf.replySequenceTokenBudget"))
            val invalid=ArchiveV2Appearance.capture(source,root).let{it.copy(basicSettings=JsonObject(it.basicSettings!!+("replySequenceToolBudget" to JsonPrimitive("999"))))}
            assertTrue(runCatching{ArchiveV2Appearance.apply(invalid,target,root,true)}.isFailure)
            assertEquals("0",target.get("wolf.replySequenceToolBudget"))
        }finally{root.deleteRecursively()}
    }

    @Test fun browserDeviceSettingsZipRestoresOnlyBasicSettings(){
        val root=Files.createTempDirectory("coast-browser-device").toFile()
        try{
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence()
            source.put("wolf.contextBudget","0");source.put("wolf.replySequenceToolBudget","0")
            target.put("wolf.themePreset","unchanged");target.put("wolf.chatBackgroundPath","unchanged-background")
            target.put("wolf.localFontPath","unchanged-font");target.put("provider.secret","target-secret")
            target.put("wolf.replySequenceToolBudget","24")
            val app="com.elementeracoast.source"
            fun make(name:String,basic:JsonObject):Pair<ArchiveV2Manifest,ArchiveV2Stage>{
                val raw=buildJsonObject{put("kind","device_basic_settings");put("data",buildJsonObject{put("basic_settings",basic)})}.toString().encodeToByteArray()
                val d=ArchiveV2Object(raw.size.toLong(),listOf(ArchiveV2Chunks.digest(raw)),ArchiveV2Chunks.fingerprint(raw.size.toLong(),listOf(ArchiveV2Chunks.digest(raw))))
                val m=ArchiveV2Manifest("elementera-coast-archive",2,"backend",app,"2026-11-26T00:00:00Z",
                    ArchiveV2Manifests.modules.map{ArchiveV2Coverage(it,if(it=="appearance")"partial" else "unavailable",if(it=="appearance")1 else 0)},
                    listOf(ArchiveV2Record("appearance",ArchiveV2Appearance.DEVICE_ID,d.objectSha256,emptyList(),emptyList())),listOf(d))
                val file=File(root,name+".zip")
                ArchiveV2ZipWriter(file.outputStream()).use{w->raw.inputStream().use{w.objectEntry(d,it)};w.finish(m)}
                val stage=ArchiveV2Stage(File(root,name+"-stage"),name)
                assertEquals(m,ArchiveV2ZipReader.stage(file,stage));return m to stage
            }
            val values=ArchiveV2Appearance.basic(source)
            val (m,stage)=make("valid",values)
            assertEquals(values,ArchiveV2Appearance.readDeviceBasic(m,stage))
            assertEquals(1,ArchiveV2Local.restore(m,stage,setOf("appearance"),app,target,false,root).counts.getValue("appearance").ready)
            assertEquals("24",target.get("wolf.replySequenceToolBudget"))
            ArchiveV2Local.restore(m,stage,setOf("appearance"),app,target,true,root)
            assertEquals("0",target.get("wolf.replySequenceToolBudget"));assertEquals("0",target.get("wolf.contextBudget"))
            assertEquals("unchanged",target.get("wolf.themePreset"))
            assertEquals("unchanged-background",target.get("wolf.chatBackgroundPath"));assertEquals("unchanged-font",target.get("wolf.localFontPath"))
            assertEquals("target-secret",target.get("provider.secret"))
            val (bad,bs)=make("bad",JsonObject(values+("replySequenceToolBudget" to JsonPrimitive("129"))))
            assertTrue(runCatching{ArchiveV2Local.restore(bad,bs,setOf("appearance"),app,target,true,root)}.isFailure)
            assertEquals("0",target.get("wolf.replySequenceToolBudget"))
        }finally{root.deleteRecursively()}
    }

    @Test fun autonomousWakeHistoryRoundTripsWithDisabledDraft(){
        val root=Files.createTempDirectory("coast-wake-v2").toFile()
        try{
            val source=MemoryLocalPersistence();val target=MemoryLocalPersistence();val cid="wake-window"
            val cache=RemoteCacheStore(source)
            cache.putConversations(listOf(com.elementeracoast.app.core.remote.RemoteConversation(cid,"自主唤醒","main")))
            cache.putHistory(cid,RemoteHistory(conversationId=cid))
            val v=Json.parseToJsonElement("""{"version":1,"settings":{"modelId":"fixture/model","config":{"timeZone":"UTC","dailyTime":"09:00","execution":{"invitation":"原始邀请","tokenBudget":8000}}},"runs":[{"claim_id":"historic","conversation_id":"wake-window","slot_key":"daily:2026-11-27","local_day":"2026-11-27","kind":"daily","model_id":"fixture/model","status":"completed","started_at":100,"updated_at":120,"result_json":"{\"total_tokens\":120}"}],"steps":[{"claim_id":"historic","step_index":0,"status":"completed","receipt_json":"{\"usage\":{\"total_tokens\":120}}","started_at":100,"finished_at":110}],"tools":[{"claim_id":"historic","step_index":0,"call_index":0,"tool_name":"dream_write_note","status":"completed","receipt_json":"{\"ok\":true}","started_at":110,"finished_at":120}],"notes":[{"claim_id":"historic","conversation_id":"wake-window","model_id":"fixture/model","body":"原始手记","created_at":120}],"replies":[]}""").jsonObject
            LocalDreamArchive(source).restore(cid,v,true)
            assertTrue(LocalDreamArchive(source).reply(cid,"historic","reply-id","原始回复"))
            val previous=LocalDreamArchive(source).export(cid)!!
            val app="com.elementeracoast.source";val zip=File(root,"wake.zip")
            val m=ArchiveV2Local.export(source,app,zip);val stage=ArchiveV2Stage(File(root,"stage"),"wake")
            assertEquals(m,ArchiveV2ZipReader.stage(zip,stage))
            ArchiveV2Local.restore(m,stage,setOf("chat"),app,target,false)
            assertNull(LocalDreamArchive(target).export(cid))
            ArchiveV2Local.restore(m,stage,setOf("chat"),app,target,true)
            assertEquals(previous,LocalDreamArchive(target).export(cid))
            val draft=Json.parseToJsonElement(target.get("local.dream.settings."+cid)).jsonObject
            assertFalse(draft.getValue("enabled").jsonPrimitive.boolean)
            assertEquals(JsonNull,draft["extraAt"])
            assertNotEquals(Json.parseToJsonElement(source.get("local.dream.settings."+cid)).jsonObject["revision"],draft["revision"])
            assertTrue(LocalDreamArchive(target).notes(cid,0).toString().contains("原始回复"))
            assertTrue(LocalDreamArchive(target).activity(cid,0).toString().contains("total_tokens"))
            val unsafe=JsonObject(v+("runs" to JsonArray(listOf(JsonObject(v.getValue("runs").jsonArray.single().jsonObject+("status" to JsonPrimitive("running")))))))
            assertTrue(runCatching{LocalDreamArchive(MemoryLocalPersistence()).restore(cid,unsafe,true)}.isFailure)
        }finally{root.deleteRecursively()}
    }
}
