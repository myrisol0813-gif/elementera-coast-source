package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

class LocalDreamExecutorTest {
    private val cid="wake-window"
    private val model="local:fixture/fixture/model"
    private val at=Instant.parse("2026-11-27T09:00:00Z").toEpochMilli()
    private val cfg=DreamConfig(timeZone="UTC",dailyTime="09:00",allowExtra=true,
        execution=DreamExecutionConfig(invitation="自在活动",tokenBudget=12000,outputLimit=500,toolBudget=4,readTurns=5,extraPerDay=1,readHistory=true,writeNote=true,includeReplies=true))
    private fun fixture():Pair<MemoryLocalPersistence,DreamSettings>{
        val store=MemoryLocalPersistence();val cache=RemoteCacheStore(store)
        cache.putConversations(listOf(RemoteConversation(cid,"wake","main"),RemoteConversation("other","other","main")))
        cache.putHistory(cid,RemoteHistory(conversationId=cid,turns=listOf(RemoteTurn("t",user=RemoteUserBranch(variants=listOf(RemoteVariant("u","window-original")))))))
        cache.putHistory("other",RemoteHistory(conversationId="other",turns=listOf(RemoteTurn("secret",user=RemoteUserBranch(variants=listOf(RemoteVariant("s","other-window-secret")))))))
        val ledger=LocalDreamLedger(store)
        val draft=ledger.configure(cid,DreamSettingsRequest(cid,null,"save",cfg,model),false,at-86400000)!!
        assertFalse(draft.enabled)
        assertNull(ledger.configure(cid,DreamSettingsRequest(cid,draft.revision,"arm",cfg,model,false),true,at-86400000))
        val armed=ledger.configure(cid,DreamSettingsRequest(cid,draft.revision,"arm",cfg,model,true),true,at-86400000)!!
        return store to armed
    }
    private fun call(id:String,name:String,args:JsonObject)=buildJsonObject{
        put("id",id);put("type","function");putJsonObject("function"){put("name",name);put("arguments",args.toString())}
    }
    private fun response(vararg calls:JsonObject,withUsage:Boolean=true)=buildJsonObject{
        put("model","fixture/model")
        if(withUsage)putJsonObject("usage"){put("total_tokens",120);put("prompt_tokens",100);put("completion_tokens",20);put("cost",0.002)}
        putJsonArray("choices"){add(buildJsonObject{
            put("finish_reason",if(calls.isEmpty())"stop"else "tool_calls")
            putJsonObject("message"){put("content","");put("tool_calls",JsonArray(calls.toList()))}
        })}
    }
    private val provider=LocalProviderConfig("fixture","fixture","https://example.com/v1","fixture-key",listOf("fixture/model"))
    @Test fun autonomousActivityPersistsToolReceiptsAndDoesNotAppendChat()=runBlocking{
        val (store,settings)=fixture();val ledger=LocalDreamLedger(store);var requests=0
        val engine=LocalDreamExecutor(store,{if(it==model)provider to "fixture/model" else null},{_,_,messages,_,_->
            requests++;assertFalse(messages.toString().contains("other-window-secret"))
            when(requests){
                1->{assertEquals("system",messages.single().jsonObject.getValue("role").jsonPrimitive.content)
                    assertFalse(messages.toString().contains("window-original"))
                    response(call("read","dream_read_history",buildJsonObject{put("mode","window");put("start",0);put("count",1)}))}
                2->{assertTrue(messages.toString().contains("window-original"))
                    response(call("note","dream_write_note",buildJsonObject{put("body","独立手记")}),call("extra","dream_schedule_extra",buildJsonObject{put("at",Instant.ofEpochMilli(at+3600000).toString())}))}
                else->response()
            }
        },clock={at})
        assertEquals("completed",engine.run(cid,settings.revision!!,model,at))
        assertEquals(3,requests)
        assertFalse(ledger.active(cid))
        assertEquals(at+3600000,ledger.settings(cid).extraAt)
        val notes=LocalDreamArchive(store).notes(cid,0).getValue("items").jsonArray
        assertEquals("独立手记",notes.single().jsonObject.getValue("body").jsonPrimitive.content)
        val claim=notes.single().jsonObject.getValue("claim_id").jsonPrimitive.content
        assertTrue(LocalDreamArchive(store).reply(cid,claim,"reply","历史回复"))
        assertEquals(3,requests)
        val history=LocalDreamArchive(store).export(cid)!!
        assertEquals(3,history.getValue("steps").jsonArray.size)
        assertEquals(3,history.getValue("tools").jsonArray.size)
        assertFalse(history.toString().contains("window-original"))
        assertFalse(history.getValue("settings").jsonObject.containsKey("enabled"))
        assertEquals(1,RemoteCacheStore(store).history(cid)!!.turns.size)
        assertEquals("not_due",engine.run(cid,settings.revision!!,model,at))
        assertEquals(3,requests)
    }
    @Test fun unknownUsageStopsBeforeToolsAndRevokedClaimCannotWrite()=runBlocking{
        val (store,settings)=fixture();val ledger=LocalDreamLedger(store);var requests=0
        val engine=LocalDreamExecutor(store,{provider to "fixture/model"},{_,_,_,_,_->
            requests++;response(call("note","dream_write_note",buildJsonObject{put("body","not saved")}),withUsage=false)
        },clock={at})
        assertEquals("failed",engine.run(cid,settings.revision!!,model,at))
        assertEquals(1,requests);assertEquals(0,LocalDreamArchive(store).notes(cid,0).getValue("items").jsonArray.size)
        val tomorrow=at+86400000
        val claim=ledger.claim(cid,settings.revision!!,model,tomorrow)!!
        assertTrue(ledger.reserveStep(claim,0,tomorrow))
        val disarmed=ledger.configure(cid,DreamSettingsRequest(cid,settings.revision,"disarm"),false,tomorrow)!!
        assertFalse(disarmed.enabled);assertNotEquals(settings.revision,disarmed.revision)
        assertFalse(ledger.authorized(claim))
        assertFalse(ledger.note(claim,"revoked",tomorrow))
        assertTrue(ledger.recover(cid,tomorrow+1))
        assertFalse(ledger.active(cid))
        assertNull(ledger.claim(cid,settings.revision!!,model,tomorrow))
        val rows=LocalDreamArchive(store).export(cid)!!.getValue("runs").jsonArray
        assertEquals("interrupted",rows.last().jsonObject.getValue("status").jsonPrimitive.content)
    }
    @Test fun scheduleQuietAndAlreadyConsumedSlots(){
        val (_,a)=fixture()
        assertEquals("daily:2026-11-27",LocalDreamSchedule.candidate(a,emptySet(),at)?.key)
        assertNull(LocalDreamSchedule.candidate(a,setOf("daily:2026-11-27"),at))
        assertNull(LocalDreamSchedule.candidate(a.copy(config=cfg.copy(quietHours=DreamQuietHours("08:00","10:00"))),emptySet(),at))
        assertNull(LocalDreamSchedule.candidate(a.copy(armedAt=at+60000),emptySet(),at+60000))
        val extra=a.copy(extraAt=at+3600000,extraId="prior")
        assertEquals("extra:prior",LocalDreamSchedule.candidate(extra,setOf("daily:2026-11-27"),at+3600000)?.key)
        val lease=LocalDreamRuntime.acquire()!!
        try{assertNull(LocalDreamRuntime.acquire())}finally{lease.close()}
        LocalDreamRuntime.acquire()!!.close()
    }
    @Test fun ordinaryPermissionsAndWakePermissionBothRequiredForLibraryTools()=runBlocking{
        val (store,initial)=fixture();val ledger=LocalDreamLedger(store);val cache=RemoteCacheStore(store)
        val cfg2=cfg.copy(execution=cfg.execution!!.copy(allowLibrary=true,allowLibraryWrite=true,includeCustom=true,tokenBudget=22000))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",cfg2,model,true),true,at-86400000)!!
        val book=LocalSideRecords(store).importBook(buildJsonObject{put("title","wake book");put("format","txt");putJsonArray("chapters"){add(buildJsonObject{put("title","one");put("body","real page fixture")})}}).getValue("id").jsonPrimitive.content
        val claim=ledger.claim(cid,settings.revision!!,model,at)!!
        assertNull(LocalToolSession.openAutonomous(store,claim))
        cache.putHistory(cid,cache.history(cid)!!.copy(contextSettings=com.elementeracoast.app.core.model.ConversationContextSettings(localModelToolsEnabled=true,localModelWriteEnabled=true)))
        val session=LocalToolSession.openAutonomous(store,claim)!!
        val names=session.completionsTools.map{it.jsonObject.getValue("function").jsonObject.getValue("name").jsonPrimitive.content}
        assertTrue("library_read" in names&&"library_write" in names)
        assertFalse("memory_search" in names||"read_mystic_dogtalk" in names)
        val page=session.execute("read","library_read",buildJsonObject{put("book_id",book);put("chapter_index",0)}.toString())
        assertTrue(page.output,page.ok);assertTrue(page.output.contains("real page fixture"))
        val write=session.execute("write","library_write",buildJsonObject{put("action","create");put("book_id",book);put("kind","reflection");put("body","independent note")}.toString())
        assertTrue(write.output,write.ok)
        val note=LocalSideRecords(store).rows().single{it.kind=="library_notes"}.data
        assertEquals(JsonNull,note["source_turn_id"]);assertEquals("assistant",note["author"]!!.jsonPrimitive.content)
        assertFalse(session.execute("delete","library_write",buildJsonObject{put("action","delete");put("id",note.getValue("id"))}.toString()).ok)
        assertTrue(LocalToolAudit(store).read().isEmpty())
        ledger.configure(cid,DreamSettingsRequest(cid,settings.revision,"disarm"),false,at)
        assertFalse(session.execute("revoked","library_read",buildJsonObject{put("book_id",book);put("chapter_index",0)}.toString()).ok)
        ledger.finish(claim,"cancelled",buildJsonObject{},null,at)
        assertEquals(1,cache.history(cid)!!.turns.size)
    }

    @Test fun ordinaryReadbackIsSeparatelyAuthorizedAndDoesNotWake()=runBlocking{
        val (store,a)=fixture();val ledger=LocalDreamLedger(store);val cache=RemoteCacheStore(store)
        val claim=ledger.claim(cid,a.revision!!,model,at)!!
        assertTrue(ledger.note(claim,"private readback fixture",at))
        assertTrue(ledger.finish(claim,"completed",buildJsonObject{},null,at))
        ledger.configure(cid,DreamSettingsRequest(cid,a.revision,"disarm"),false,at)
        val history=cache.history(cid)!!
        val base=history.contextSettings.copy(localModelToolsEnabled=true)
        cache.putHistory(cid,history.copy(contextSettings=base))
        val desk=RemoteDeskSlip(contextBudget=RemoteDeskContextBudget(comfortCeiling=10000))
        fun session()=LocalToolSession.open(store,cid,"t",null,desk,model)!!
        assertFalse(session().completionsTools.toString().contains("dream_readback"))
        cache.putHistory(cid,history.copy(contextSettings=base.copy(dreamReadbackEnabled=true)))
        val reader=session()
        val result=reader.execute("readback","dream_readback","""{"kind":"notes"}""")
        assertTrue(result.output,result.ok);assertTrue(result.output.contains("private readback fixture"))
        assertFalse(reader.execute("cross","dream_readback","""{"kind":"notes","conversation_id":"other"}""").ok)
        cache.putHistory(cid,history.copy(contextSettings=base))
        assertFalse(reader.execute("revoked","dream_readback","""{"kind":"notes"}""").ok)
        assertFalse(ledger.settings(cid).enabled)
        assertEquals(1,LocalDreamArchive(store).export(cid)!!.getValue("runs").jsonArray.size)
    }

    @Test fun canonicalDailyAndCalendarCreationHasWakeProvenance()=runBlocking{
        val (store,initial)=fixture();val cache=RemoteCacheStore(store);val ledger=LocalDreamLedger(store)
        val history=cache.history(cid)!!
        cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
        val cfg2=cfg.copy(execution=cfg.execution!!.copy(allowDailyWrite=true,allowCalendarWrite=true,tokenBudget=24000,toolBudget=5))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",cfg2,model,true),true,at-86400000)!!
        var requests=0
        val engine=LocalDreamExecutor(store,{provider to "fixture/model"},{_,_,_,tools,_->
            requests++
            if(requests==1){
                assertTrue(tools.toString().contains("create_diary"))
                assertFalse(tools.toString().contains("moment_comment"))
                response(call("d","create_diary",buildJsonObject{put("date","2026-11-27");put("text","fixture diary")}),
                    call("m","create_moment",buildJsonObject{put("date","2026-11-27");put("text","fixture moment")}),
                    call("c","calendar_create",buildJsonObject{put("date","2026-11-28");put("title","fixture calendar");put("kind","note")}))
            }else response()
        },clock={at})
        assertEquals("completed",engine.run(cid,settings.revision!!,model,at))
        assertEquals(2,requests)
        val diary=cache.dailyDiaries().single();val moment=cache.dailyMoments().single()
        val calendar=LocalCalendarStore(store).snapshot().single().jsonObject
        assertNull(diary.sourceTurnId);assertNull(moment.sourceTurnId)
        assertEquals(JsonNull,calendar["source_turn_id"])
        assertEquals(cid,calendar.getValue("conversation_id").jsonPrimitive.content)
        assertTrue(calendar.getValue("tool_call_id").jsonPrimitive.content.startsWith("dream:"))
        val restoredCalendar=LocalCalendarStore(MemoryLocalPersistence())
        restoredCalendar.restoreSnapshot(JsonArray(listOf(calendar)))
        assertEquals(calendar,restoredCalendar.snapshot().single())
        val invalid=JsonObject(calendar+("tool_call_id" to JsonPrimitive("ordinary-tool")))
        assertTrue(runCatching{restoredCalendar.restoreSnapshot(JsonArray(listOf(invalid)))}.isFailure)
        assertEquals(calendar,restoredCalendar.snapshot().single())
        assertEquals("model_partner",diary.author)
        assertTrue(diary.toolCallId.orEmpty().startsWith("dream:"))
        val events=LocalDreamArchive(store).export(cid)!!.getValue("tools").jsonArray
        assertEquals(listOf(diary.id,moment.id,calendar.getValue("id").jsonPrimitive.content),events.map{
            Json.parseToJsonElement(it.jsonObject.getValue("receipt_json").jsonPrimitive.content).jsonObject.getValue("record_id").jsonPrimitive.content
        })
        assertEquals(1,cache.history(cid)!!.turns.size)
    }


    @Test fun autonomousVoiceUsesRealOriginalAndClaimWithoutChatTurn()=runBlocking{
        val (store,initial)=fixture();val cache=RemoteCacheStore(store);val ledger=LocalDreamLedger(store)
        val history=cache.history(cid)!!
        cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
        val cfg2=cfg.copy(execution=cfg.execution!!.copy(allowVoice=true,voiceLimit=2,tokenBudget=24000))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",cfg2,model,true),true,at-86400000)!!
        val bytes=byteArrayOf(73,68,51,4,0,0,0,0,0,0,1,2)
        var generated=0
        val http=OkHttpClient.Builder().addInterceptor{chain->
            generated++
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(bytes.toResponseBody()).build()
        }.build()
        val speech=LocalVoiceProvider({LocalProviderConfig("elevenlabs","ElevenLabs","https://api.elevenlabs.io","fixture-only",listOf("fixtureVoice"))},http)
        var requests=0
        val engine=LocalDreamExecutor(store,{provider to "fixture/model"},{_,_,_,tools,_->
            requests++
            if(requests==1){
                assertTrue(tools.toString().contains("voice_create"))
                response(call("v","voice_create",buildJsonObject{put("text","independent speech")}))
            }else response()
        },clock={at},voice=speech)
        assertEquals("completed",engine.run(cid,settings.revision!!,model,at))
        assertEquals(2,requests);assertEquals(1,generated)
        val side=LocalSideRecords(store);val row=side.clips(cid).single()
        assertEquals("dream_tide",row.getValue("source").jsonPrimitive.content)
        assertEquals(JsonNull,row["turn_id"]);assertEquals(JsonNull,row["message_id"])
        val id=row.getValue("id").jsonPrimitive.content
        assertTrue(id.startsWith("voice_dream_"))
        assertArrayEquals(bytes,side.bytes(side.audio(id)!!))
        assertEquals(1,cache.history(cid)!!.turns.size)
        val event=LocalDreamArchive(store).export(cid)!!.getValue("tools").jsonArray.single().jsonObject
        assertEquals(id,Json.parseToJsonElement(event.getValue("receipt_json").jsonPrimitive.content).jsonObject.getValue("record_id").jsonPrimitive.content)
    }

    @Test fun autonomousVoiceRequiresClaimAndRefusesSaveAfterRevocation(){
        val (store,initial)=fixture();val cache=RemoteCacheStore(store);val ledger=LocalDreamLedger(store)
        val history=cache.history(cid)!!
        cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
        val cfg2=cfg.copy(execution=cfg.execution!!.copy(allowVoice=true,voiceLimit=2,tokenBudget=24000))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",cfg2,model,true),true,at-86400000)!!
        val claim=ledger.claim(cid,settings.revision!!,model,at)!!
        var generated=0
        val bytes=byteArrayOf(73,68,51,4,0,0,0,0,0,0,1,2)
        val http=OkHttpClient.Builder().addInterceptor{chain->
            generated++
            assertNotNull(ledger.configure(cid,DreamSettingsRequest(cid,settings.revision,"disarm"),false,at))
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(bytes.toResponseBody()).build()
        }.build()
        val speech=LocalVoiceProvider({LocalProviderConfig("elevenlabs","ElevenLabs","https://api.elevenlabs.io","fixture-only",listOf("fixtureVoice"))},http)
        val session=LocalToolSession.openAutonomous(store,claim,voice=speech)!!
        val args=buildJsonObject{put("text","revoked speech")}.toString()
        assertFalse(session.execute("unclaimed","voice_create",args).ok);assertEquals(0,generated)
        assertTrue(ledger.reserveStep(claim,0,at))
        assertTrue(ledger.recordStep(claim,0,true,buildJsonObject{},at))
        assertTrue(ledger.reserveTool(claim,0,0,"voice_create",at))
        assertFalse(session.execute(claim.id+":0:0","voice_create",args).ok)
        assertEquals(1,generated);assertTrue(LocalSideRecords(store).clips(cid).isEmpty())
    }


    @Test fun independentImageOriginalKeepsActivityIdentityAndCannotBecomeChatAttachment(){
        val (store,initial)=fixture();val cache=RemoteCacheStore(store);val ledger=LocalDreamLedger(store)
        val history=cache.history(cid)!!
        cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
        val cfg2=cfg.copy(execution=cfg.execution!!.copy(allowImage=true,imageLimit=2,tokenBudget=24000))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",cfg2,model,true),true,at-86400000)!!
        val imageConfig=LocalProviderConfig("image-fixture","fixture","https://openrouter.ai/api/v1","fixture-only",listOf("fixture/paid"))
        val selected=imageConfig.modelId("fixture/paid")
        cache.putProfile(RemoteProfile(currentImageModel=selected))
        val claim=ledger.claim(cid,settings.revision!!,model,at)!!
        assertTrue(ledger.reserveStep(claim,0,at))
        assertTrue(ledger.recordStep(claim,0,true,buildJsonObject{},at))
        assertTrue(ledger.reserveTool(claim,0,0,"image_generate",at))
        val bytes=ByteArray(24);byteArrayOf(137.toByte(),80,78,71,13,10,26,10).copyInto(bytes)
        var calls=0
        val generator=LocalDreamImage(store,claim,selected,{imageConfig},
            discover={listOf(LocalImageProvider.Model("fixture/paid","fixture",false))},
            generate={_,_->calls++;LocalImageProvider.Generated(bytes,"image/png","openrouter","fixture/paid",null,null,"fixture")})
        val result=generator.execute(claim.id+":0:0",buildJsonObject{put("prompt","fixture")})
        val original=LocalAttachmentStore(store).entries().single()
        assertEquals("att_dream_"+claim.id+"_0_0",result.getValue("id").jsonPrimitive.content)
        assertEquals(JsonNull,original.metadata["turn_id"])
        assertArrayEquals(bytes,LocalAttachmentStore(store).bytes(original))
        assertEquals(1,cache.history(cid)!!.turns.size)
        assertTrue(runCatching{LocalAttachmentStore.validate(JsonObject(original.metadata+("turn_id" to JsonPrimitive("t"))))}.isFailure)
        assertTrue(runCatching{generator.execute(claim.id+":0:0",buildJsonObject{put("prompt","again")})}.isFailure)
        assertEquals(1,calls)
        assertTrue(ledger.reserveTool(claim,0,1,"image_generate",at))
        val revoked=LocalDreamImage(store,claim,selected,{imageConfig},
            discover={listOf(LocalImageProvider.Model("fixture/paid","fixture",false))},
            generate={_,_->assertNotNull(ledger.configure(cid,DreamSettingsRequest(cid,settings.revision,"disarm"),false,at));LocalImageProvider.Generated(bytes,"image/png","openrouter","fixture/paid",null,null,"fixture")})
        assertTrue(runCatching{revoked.execute(claim.id+":0:1",buildJsonObject{put("prompt","revoked")})}.isFailure)
        assertEquals(1,LocalAttachmentStore(store).entries().size)
    }


    @Test fun autonomousMediaAndFavoritesSurviveCompleteNativeArchiveWithoutRearming(){
        val dir=java.nio.file.Files.createTempDirectory("dream-media-v2").toFile()
        try{
            val (store,initial)=fixture();val cache=RemoteCacheStore(store);val ledger=LocalDreamLedger(store)
            val history=cache.history(cid)!!
            cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
            val cfg2=cfg.copy(execution=cfg.execution!!.copy(allowImage=true,allowVoice=true,tokenBudget=24000))
            val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",cfg2,model,true),true,at-86400000)!!
            val claim=ledger.claim(cid,settings.revision!!,model,at)!!
            assertTrue(ledger.reserveStep(claim,0,at));assertTrue(ledger.recordStep(claim,0,true,buildJsonObject{},at))
            val pictureId="att_dream_"+claim.id+"_0_0";val voiceId="voice_dream_"+claim.id+"_0_1"
            val png=ByteArray(24);byteArrayOf(137.toByte(),80,78,71,13,10,26,10).copyInto(png)
            val mp3=byteArrayOf(73,68,51,4,0,0,0,0,0,0,1,2)
            val meta=buildJsonObject{put("id",pictureId);put("conversation_id",cid);put("turn_id",JsonNull);put("kind","image");put("name","自主活动图像.png");put("mime","image/png");put("size",png.size);put("created_at",at);put("updated_at",at)}
            assertTrue(ledger.reserveTool(claim,0,0,"image_generate",at))
            store.atomic{s->LocalAttachmentStore(s).publish(LocalAttachmentStore.Original(meta,ArchiveV2Chunks.digest(png)),png)}
            assertTrue(ledger.recordTool(claim,0,0,true,null,at,pictureId))
            assertTrue(ledger.reserveTool(claim,0,1,"voice_create",at))
            store.atomic{s->saveLocalVoice(s,cid,null,null,"dream_tide",model,LocalVoiceProvider.Generated("fixtureVoice","fixture speech",mp3),voiceId)}
            assertTrue(ledger.recordTool(claim,0,1,true,null,at,voiceId))
            assertTrue(ledger.finish(claim,"completed",buildJsonObject{},null,at))
            val side=LocalSideRecords(store)
            for((kind,id) in listOf("image" to pictureId,"audio" to voiceId)){
                val favorite=side.saveTreasure(buildJsonObject{put("kind",kind);put("conversation_id",cid);put("source_id",id);put("notes","fixture favorite")})
                assertEquals("assistant",favorite.getValue("role").jsonPrimitive.content)
                assertEquals(JsonNull,favorite["message_id"])
            }
            val app="com.elementeracoast.source";val zip=java.io.File(dir,"complete.zip")
            val manifest=ArchiveV2Local.export(store,app,zip)
            val stage=ArchiveV2Stage(dir,"verified");ArchiveV2ZipReader.stage(zip,stage)
            val dst=MemoryLocalPersistence();val selected=setOf("chat","attachments","voice","vault")
            ArchiveV2Local.restore(manifest,stage,selected,app,dst,false)
            assertTrue(RemoteCacheStore(dst).conversations().isEmpty())
            ArchiveV2Local.restore(manifest,stage,selected,app,dst,true)
            assertEquals(LocalDreamArchive(store).export(cid),LocalDreamArchive(dst).export(cid))
            assertFalse(LocalDreamLedger(dst).settings(cid).enabled)
            assertEquals(1,RemoteCacheStore(dst).history(cid)!!.turns.size)
            val originals=LocalAttachmentStore(dst);assertArrayEquals(png,originals.bytes(originals.entries().single()))
            val restored=LocalSideRecords(dst);assertArrayEquals(mp3,restored.bytes(restored.audio(voiceId)!!))
            assertEquals(side.rows(),restored.rows())
            val archive=LocalDreamArchive(dst)
            for(id in listOf(pictureId,voiceId))assertEquals(JsonPrimitive(claim.id),archive.activity(cid,0,id).getValue("items").jsonArray.single().jsonObject["claim_id"])
            assertTrue(archive.activity(cid,0,pictureId+"_forged").getValue("items").jsonArray.isEmpty())
            assertTrue(archive.activity("other",0,voiceId).getValue("items").jsonArray.isEmpty())
        }finally{dir.deleteRecursively()}
    }


    @Test fun mediaReservationBudgetsAreIndependentAndZeroDisables(){
        val (store,initial)=fixture();val ledger=LocalDreamLedger(store)
        val config=cfg.copy(execution=cfg.execution!!.copy(allowVoice=true,allowImage=true,voiceLimit=2,imageLimit=0))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",config,model,true),true,at-86400000)!!
        val claim=ledger.claim(cid,settings.revision!!,model,at)!!
        assertTrue(ledger.reserveStep(claim,0,at));assertTrue(ledger.recordStep(claim,0,true,buildJsonObject{},at))
        assertFalse(ledger.reserveTool(claim,0,0,"image_generate",at))
        assertTrue(ledger.reserveTool(claim,0,1,"voice_create",at))
        assertTrue(ledger.reserveTool(claim,0,2,"voice_create",at))
        assertFalse(ledger.reserveTool(claim,0,3,"voice_create",at))
        assertTrue(ledger.reserveTool(claim,0,4,"dream_write_note",at))
    }


    @Test fun dreamMemoryCandidateStaysPendingAndDoesNotReviveDiscardedCandidate()=runBlocking{
        val (store,initial)=fixture();val ledger=LocalDreamLedger(store);val cache=RemoteCacheStore(store)
        val history=cache.history(cid)!!
        cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
        val config=cfg.copy(execution=cfg.execution!!.copy(allowMemoryCandidate=true,tokenBudget=24000))
        val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",config,model,true),true,at-86400000)!!
        val input=buildJsonObject{put("title","一颗候选");put("content","fixture memory candidate");put("destination","memory")}
        var requests=0
        val engine=LocalDreamExecutor(store,{provider to "fixture/model"},{_,_,_,tools,_->
            requests++
            if(requests==1){
                assertTrue(tools.toString().contains("dream_memory_candidate"))
                response(call("m1","dream_memory_candidate",input),call("m2","dream_memory_candidate",input))
            }else response()
        },clock={at})
        assertEquals("completed",engine.run(cid,settings.revision!!,model,at))
        val memory=LocalMemoryStore(store);val candidate=memory.snapshot().pockets.single()
        assertEquals(JsonPrimitive("dream_tide"),candidate["source_type"])
        assertEquals(JsonPrimitive("pending"),candidate["status"])
        assertTrue(memory.snapshot().entries.isEmpty())
        assertEquals(1,cache.history(cid)!!.turns.size)
        val id=candidate.getValue("id").jsonPrimitive.content
        memory.resolve(id,RemoteMemoryPocketResolveRequest(action="discard"))
        val later=at+86400000
        val claim=ledger.claim(cid,settings.revision!!,model,later)!!
        assertTrue(ledger.reserveStep(claim,0,later));assertTrue(ledger.recordStep(claim,0,true,buildJsonObject{},later))
        assertTrue(ledger.reserveTool(claim,0,0,"dream_memory_candidate",later))
        assertEquals(JsonPrimitive("duplicate_suppressed"),memory.proposeDreamCandidate(claim,0,0,input,later)["status"])
        assertTrue(memory.pockets(cid).isEmpty())
        assertNotNull(ledger.configure(cid,DreamSettingsRequest(cid,settings.revision,"disarm"),false,later))
        assertTrue(runCatching{memory.proposeDreamCandidate(claim,0,0,JsonObject(input+("content" to JsonPrimitive("revoked"))),later)}.isFailure)
        assertEquals(1,memory.snapshot().pockets.size)
    }


    @Test fun autonomousImagePixelsAreOneShotOptInAndBudgeted()=runBlocking{
        for((permission,vision,budget) in listOf(Triple(true,true,24000),Triple(false,true,24000),Triple(true,false,24000),Triple(true,null,24000),Triple(true,true,1800))){
            val (store,initial)=fixture();val cache=RemoteCacheStore(store);val ledger=LocalDreamLedger(store)
            val history=cache.history(cid)!!
            cache.putHistory(cid,history.copy(contextSettings=history.contextSettings.copy(localModelWriteEnabled=true)))
            val config=cfg.copy(execution=cfg.execution!!.copy(allowImage=true,allowImageReadback=permission,tokenBudget=budget))
            val settings=ledger.configure(cid,DreamSettingsRequest(cid,initial.revision,"arm",config,model,true),true,at-86400000)!!
            val imageConfig=LocalProviderConfig("image-fixture","fixture","https://openrouter.ai/api/v1","fixture-only",listOf("fixture/paid"))
            cache.putProfile(RemoteProfile(currentImageModel=imageConfig.modelId("fixture/paid")))
            val bytes=ByteArray(24);byteArrayOf(137.toByte(),80,78,71,13,10,26,10).copyInto(bytes)
            var requests=0;var seen=0
            val engine=LocalDreamExecutor(store,{provider to "fixture/model"},{_,_,messages,_,_->
                requests++
                val parts=messages.flatMap{m->(m.jsonObject["content"] as? JsonArray).orEmpty()}.filter{it.jsonObject["type"]==JsonPrimitive("image_url")}
                if(parts.isNotEmpty()){
                    seen++;assertEquals(1,parts.size)
                    val url=parts.single().jsonObject.getValue("image_url").jsonObject.getValue("url").jsonPrimitive.content
                    assertArrayEquals(bytes,java.util.Base64.getDecoder().decode(url.substringAfter(',')))
                }
                when(requests){
                    1->response(call("i","image_generate",buildJsonObject{put("prompt","fixture")}))
                    2->response(call("n","dream_write_note",buildJsonObject{put("body","fixture note")}))
                    else->response()
                }
            },clock={at},imageProvider={imageConfig},modelBudget={_,_,_->LocalInputBudget(18000,null,100000,"fixture",vision)},
                imageFactory={s,c,id,resolver->LocalDreamImage(s,c,id,resolver,
                    discover={listOf(LocalImageProvider.Model("fixture/paid","fixture",false))},
                    generate={_,_->LocalImageProvider.Generated(bytes,"image/png","openrouter","fixture/paid",null,null,"fixture")})})
            val status=engine.run(cid,settings.revision!!,model,at)
            if(budget==24000)assertEquals("completed",status)
            val expected=permission&&vision==true&&budget==24000
            assertEquals(if(expected)1 else 0,seen)
            val archive=LocalDreamArchive(store).export(cid)!!.toString()
            assertEquals(expected,archive.contains("image_readback_accepted"))
            assertFalse(archive.contains("data:image/"));assertEquals(1,cache.history(cid)!!.turns.size)
        }
    }

}
