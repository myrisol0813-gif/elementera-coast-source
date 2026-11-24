package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** Local owner knowledge uses the same typed store as the existing memory UI.
 * Both inference transports use the same assembly and record only delivered text. */
internal class LocalKnowledgeStore(store:LocalPersistence) {
    private val cache=RemoteCacheStore(store,strictReads=true)
    private val memory=LocalMemoryStore(store)
    private val portraits=LocalPortraitStore(store)
    private val soil=LocalSoilStore(store)
    private val attachments=LocalAttachmentStore(store)
    fun instructions()=cache.customInstructions()
    fun saveInstructions(request:RemoteCustomInstructionsPutRequest):RemoteCustomInstructions {
        require(request.content.length<=32000&&request.updatedBy.length in 1..80&&request.source.length in 1..80){"自定义指令或来源字段超限。"}
        return RemoteCustomInstructions(content=request.content,updatedAt=Instant.ofEpochMilli(System.currentTimeMillis()).toString(),updatedBy=request.updatedBy,source=request.source).also(cache::putCustomInstructions)
    }
    fun entries()=cache.worldbookEntries().sortedWith(compareByDescending<RemoteWorldbookEntry>{it.priority}.thenBy{it.title}.thenBy{it.id})
    fun saveWorldbook(id:String?,v:RemoteWorldbookEntryWriteRequest):RemoteWorldbookEntry {
        val all=entries()
        val old=id?.let { key->all.firstOrNull{it.id==key}?:throw LocalCalendarError("worldbook_not_found","词条不存在。",404) }
        val now=Instant.ofEpochMilli(System.currentTimeMillis()).toString()
        val row=RemoteWorldbookEntry(id=id?:"world_"+UUID.randomUUID(),title=v.title.trim(),content=v.content.trim(),keywords=v.keywords.map(String::trim).filter(String::isNotBlank).distinct(),
            useRegex=v.useRegex,caseSensitive=v.caseSensitive,constantActive=v.constantActive,priority=v.priority,scanDepth=v.scanDepth,enabled=v.enabled,scope=v.scope,visitorSafe=v.visitorSafe,createdAt=old?.createdAt?:now,updatedAt=now)
        val next=all.filterNot{it.id==row.id}+row
        validateWorldbook(next)
        cache.putWorldbookEntries(next)
        return row
    }
    fun disableWorldbook(id:String) {
        val all=entries()
        require(all.any{it.id==id}){"词条不存在。"}
        cache.putWorldbookEntries(all.map{if(it.id==id)it.copy(enabled=false,updatedAt=Instant.ofEpochMilli(System.currentTimeMillis()).toString())else it})
    }
    data class Match(val entry:RemoteWorldbookEntry,val keywords:List<String>,val by:String)
    fun match(input:String,messages:List<RemoteChatMessage>,surface:String="main_chat",limit:Int=6,allowedScopes:List<String> = emptyList()):List<Match> {
        // No visitor endpoint in local mode; never use a caller-controlled scope to expose visitor content.
        require(surface!="mailbox_visitor")
        val available=entries().filter{it.enabled&&it.scope!="visitor"&&(if(allowedScopes.isNotEmpty())it.scope in allowedScopes else it.scope in setOf("owner","both",surface))}
        fun triggers(e:RemoteWorldbookEntry,text:String)=e.keywords.filter { key->
            if(e.useRegex)Regex(key,if(e.caseSensitive)emptySet()else setOf(RegexOption.IGNORE_CASE)).containsMatchIn(text)
            else text.contains(key,ignoreCase=!e.caseSensitive)
        }
        val matches=available.mapNotNull{e->
            if(e.constantActive)return@mapNotNull Match(e,emptyList(),"constant")
            val current=triggers(e,input)
            if(current.isNotEmpty())Match(e,current,"user_input")
            else {val recent=triggers(e,messages.filter{it.role in setOf("user","assistant")}.takeLast(e.scanDepth).joinToString("\n"){it.content})
                if(recent.isEmpty())null else Match(e,recent,"recent_message")}
        }
        return matches.filter{it.by=="constant"}+matches.filter{it.by!="constant"}.take(limit.coerceIn(0,6))
    }
    fun surfaceFor(conversationId:String):String=cache.conversations().firstOrNull{it.id==conversationId}?.roomType?.let{if(it=="main")"main_chat" else it}?:error("本机窗口不存在。")
    data class Context(val messages:List<RemoteChatMessage>,val receipt:RemoteDeskSlip)
    fun context(input:List<RemoteChatMessage>,budget:Int,surface:String,conversationId:String="",attachmentIds:List<String> = emptyList()):Context {
        val attachmentContext=attachments.textContext(conversationId,attachmentIds,input)
        val messages=attachmentContext.messages
        val instructions=instructions()?.content.orEmpty()
        val current=messages.lastOrNull{it.role=="user"}?.content.orEmpty()
        val maxChars=budget.coerceAtLeast(1800).toLong()*3
        require(messages.sumOf{it.content.length.toLong()}+instructions.length<=maxChars){"本机上下文或自定义指令超过预算，未截断、未发送。"}
        val matches=match(current,messages,surface)
        val delivered=mutableListOf<RemoteChatMessage>()
        if(instructions.isNotEmpty())delivered.add(RemoteChatMessage("system",instructions))
        val userPortrait=portraits.body("user_portrait")
        val selfPortrait=portraits.body("self_portrait")
        if(userPortrait.isNotEmpty())delivered.add(RemoteChatMessage("system","用户画像\n"+userPortrait))
        if(selfPortrait.isNotEmpty())delivered.add(RemoteChatMessage("system","自我画像\n"+selfPortrait))
        matches.forEach{delivered.add(RemoteChatMessage("system","世界书 · "+it.entry.title+"\n"+it.entry.content))}
        val memories=memory.recall(current,conversationId)
        val memoryText=memories.map{e->listOf("记忆 · "+e.title,"生命核："+e.lifeCore,e.content,e.usageHint.takeIf{it.isNotBlank()}?.let{"使用时机："+it}.orEmpty(),e.avoidHint.takeIf{it.isNotBlank()}?.let{"勿误用："+it}.orEmpty()).filter{it.isNotBlank()}.joinToString("\n")}
        memoryText.forEach{delivered.add(RemoteChatMessage("system",it))}
        val soilRow=soil.current(conversationId)
        val soilText=soilRow?.get("current_text")?.jsonPrimitive?.contentOrNull.orEmpty()
        val after=soilRow?.get("afterthoughts_json")?.jsonPrimitive?.contentOrNull?.let{Json.parseToJsonElement(it).jsonArray.map{v->v.jsonPrimitive.content}}.orEmpty()
        val soilContext=(listOf(soilText)+after).filter{it.isNotBlank()}.joinToString("\n")
        if(soilContext.isNotEmpty())delivered.add(RemoteChatMessage("system","思维壤\n"+soilContext))
        delivered.addAll(messages)
        val chars=delivered.sumOf{it.content.length.toLong()}
        require(chars<=maxChars){"本机上下文、完整画像、世界书与记忆超过预算，未截断、未发送。"}
        return Context(delivered,RemoteDeskSlip(
            summary="本机自定义指令、完整画像、世界书、已确认记忆（关键词检索）、思维壤与近期文字；附件按本轮回执递入",
            attachments=attachmentContext.receipt.takeIf{attachmentIds.isNotEmpty()},
            customInstructions=RemoteDeskCustomInstructions(status=if(instructions.isEmpty())"未设置" else "已递给",delivered=instructions.isNotEmpty(),empty=instructions.isEmpty(),length=instructions.length,content=instructions),
            userPortrait=portraitReceipt("用户画像",userPortrait),
            globalExcerpt=portraitReceipt("自我画像",selfPortrait),
            thinkingSoil=RemoteDeskThinkingSoil(status=if(soilContext.isEmpty())"未设置" else "已递给",enabled=soilRow?.get("auto_refresh_enabled")?.jsonPrimitive?.int==1,delivered=soilContext.isNotEmpty(),empty=soilContext.isEmpty(),context=soilContext,currentText=soilText,afterthoughts=after,afterthoughtsCount=after.size),
            worldbook=RemoteDeskWorldbook(status=if(matches.isEmpty())"未命中" else "已递给",matchedCount=matches.size,deliveredCount=matches.size,matchedTitles=matches.map{it.entry.title},deliveredTitles=matches.map{it.entry.title},
                entries=matches.map{RemoteDeskWorldbookItem(title=it.entry.title,id=it.entry.id,matchedKeywords=it.keywords,content=it.entry.content,scope=it.entry.scope,matchedBy=it.by,delivered=true,deliveredText=it.entry.content)}),
            relatedMemory=RemoteDeskMemory(status=if(memories.isEmpty())"未命中" else "已递给",confirmationStatus="仅已确认的 active 记录",count=memories.size,
                items=memories.mapIndexed{i,e->RemoteDeskMemoryItem(title=e.title,id=e.id,entryType=e.entryType,tag=e.tag,sourceModel=e.sourceModel,sourceWindow=e.sourceWindow,sourceDate=e.sourceDate,reason="本机关键词命中",lifeCore=e.lifeCore,usageHint=e.usageHint,avoidHint=e.avoidHint,content=e.content,deliveredText=memoryText[i])}),
            contextBudget=RemoteDeskContextBudget(estimatedTokens=((chars+2)/3).coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),comfortCeiling=budget.coerceAtLeast(1800),sourcesPreserved=listOf("recent_context")+(if(instructions.isEmpty())emptyList()else listOf("custom_instructions"))+(if(matches.isEmpty())emptyList()else listOf("worldbook"))+(if(memories.isEmpty())emptyList()else listOf("related_memory"))+(if(userPortrait.isEmpty())emptyList()else listOf("user_portrait"))+(if(selfPortrait.isEmpty())emptyList()else listOf("global_excerpt")),userPortrait=if(userPortrait.isEmpty())"empty" else "full",globalExcerpt=if(selfPortrait.isEmpty())"empty" else "full")
        ))
    }
    private fun portraitReceipt(label:String,body:String)=RemoteDeskGlobalExcerpt(label=label,status=if(body.isEmpty())"未设置" else "已递给",delivered=body.isNotEmpty(),injection=if(body.isEmpty())"none" else "full",estimatedTokens=(body.length+2)/3,length=body.length,content=body)
    companion object {
        fun validateWorldbook(rows:List<RemoteWorldbookEntry>){
            require(rows.map{it.id}.distinct().size==rows.size&&rows.count{it.enabled&&it.constantActive}<=3){"世界书 ID 重复或常驻词条超过三条。"}
            for(e in rows){
                require(e.id.matches(Regex("[A-Za-z0-9_.:-]{1,160}"))&&e.title.isNotBlank()&&e.title.length<=160&&e.content.isNotBlank()&&e.content.length<=12000)
                require(e.keywords.size<=30&&e.keywords.distinct().size==e.keywords.size&&e.keywords.all{it.isNotBlank()&&it.length<=160})
                require(e.priority in -1000..1000&&e.scanDepth in 1..20&&e.scope in setOf("owner","visitor","both","mailbox","lighthouse","radio","official_mcp","daily"))
                if(e.useRegex)e.keywords.forEach{Regex(it)}
            }
        }
    }
}
