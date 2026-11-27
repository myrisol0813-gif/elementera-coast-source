package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

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
        assertEquals("model_partner",diary.author)
        assertTrue(diary.toolCallId.orEmpty().startsWith("dream:"))
        val events=LocalDreamArchive(store).export(cid)!!.getValue("tools").jsonArray
        assertEquals(listOf(diary.id,moment.id,calendar.getValue("id").jsonPrimitive.content),events.map{
            Json.parseToJsonElement(it.jsonObject.getValue("receipt_json").jsonPrimitive.content).jsonObject.getValue("record_id").jsonPrimitive.content
        })
        assertEquals(1,cache.history(cid)!!.turns.size)
    }

}
