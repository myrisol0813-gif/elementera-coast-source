package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** Local owner knowledge uses the same typed store as the existing memory UI.
 * Both inference transports use the same assembly and record only delivered text. */
internal class LocalKnowledgeStore(private val store:LocalPersistence,private val web:LocalIndependentWeb?=null,private val voice:LocalVoiceProvider?=null) {
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
    data class Context(val messages:List<RemoteChatMessage>,val receipt:RemoteDeskSlip,val imageParts:List<JsonObject> = emptyList())
    fun context(input:List<RemoteChatMessage>,budget:Int,surface:String,conversationId:String="",attachmentIds:List<String> = emptyList(),turnId:String="",crossWindow:RemoteCrossWindowRequest?=null,reality:RemoteRealityContext=RemoteRealityContext(),inputPolicy:LocalInputBudget?=null,groupDogtalk:String?=null):Context {
        val attachmentContext=attachments.attachmentContext(conversationId,attachmentIds,input)
        require(inputPolicy?.vision!=false||attachmentContext.imageParts.isEmpty()){"供应商目录报告当前模型不支持图片输入；附件未发送，请更换模型。"}
        val messages=attachmentContext.messages
        val instructions=instructions()?.content.orEmpty()
        val current=messages.lastOrNull{it.role=="user"}?.content.orEmpty()
        val matches=match(current,messages.dropLast(if(messages.lastOrNull()?.role=="user")1 else 0),surface)
        val userPortrait=portraits.body("user_portrait")
        val selfPortrait=portraits.body("self_portrait")
        val recall=memory.recallDetailed(current,conversationId)
        val memories=recall.entries
        val memoryText=memories.map{e->listOf("标题："+e.title,"类型："+e.entryType,e.tag.takeIf{it.isNotBlank()}?.let{"标签："+it}.orEmpty(),e.sourceWindow.takeIf{it.isNotBlank()}?.let{"来源窗口："+it}.orEmpty(),"生命核："+e.lifeCore,e.usageHint.takeIf{it.isNotBlank()}?.let{"使用时机："+it}.orEmpty(),e.avoidHint.takeIf{it.isNotBlank()}?.let{"勿误用："+it}.orEmpty(),"内容："+e.content).filter{it.isNotBlank()}.joinToString("\n")}
        val soilRow=soil.current(conversationId)
        val soilEnabled=soilRow?.get("auto_refresh_enabled")?.jsonPrimitive?.int==1
        val soilText=soilRow?.takeIf{soilEnabled}?.get("current_text")?.jsonPrimitive?.contentOrNull.orEmpty()
        val after=soilRow?.takeIf{soilEnabled}?.get("afterthoughts_json")?.jsonPrimitive?.contentOrNull?.let{Json.parseToJsonElement(it).jsonArray.map{v->v.jsonPrimitive.content}}.orEmpty()
        // null retains ordinary one-time read; a non-null group value (even
        // empty) disables live-drawer access for every subsequent request.
        val dogtalk=if(groupDogtalk==null)LocalDogtalkStore(store).pending(conversationId,surface,turnId)else null
        val cross = if(crossWindow?.mode=="model_decides"){
            require(cache.history(conversationId)?.contextSettings?.crossWindowAuto==true){"跨窗口自主检索未授权。"}
            LocalCrossWindow.Selection("",RemoteDeskCrossWindow(mode="model_decides",status="已开放 · 未调用"))
        }else LocalCrossWindow(store).select(conversationId,crossWindow)
        val settings=cache.history(conversationId)?.contextSettings?:com.elementeracoast.app.core.model.ConversationContextSettings()
        val real=localReality(store,settings,reality)
        val responseMode=localResponseMode(settings)
        val comfort=LocalContextPolicy.assemble(instructions,userPortrait,selfPortrait,LocalContextPolicy.formatSoil(soilText,after),memoryText,
            matches.map{it.entry.title+"："+it.entry.content},groupDogtalk?:dogtalk?.text.orEmpty(),cross.text,
            real.context.takeIf{real.delivered}.orEmpty(),responseMode.context.takeIf{responseMode.delivered}.orEmpty(),
            messages,budget,attachmentContext.imageParts.size)
        require(inputPolicy?.materialLimit?.let{comfort.estimated<=it}!=false){"完整当前消息、附件或画像超出模型目录估算的输入容量；未截断、未发送。请减少附件或调整输出上限。"}
        val deliveredMemory=memories.take(comfort.memoryCount)
        val deliveredWorld=matches.take(comfort.worldbookCount)
        val soilContext=comfort.soil
        val currentMessage=comfort.visible.lastOrNull()?.takeIf{it.role=="user"}
        val recent=if(currentMessage==null)comfort.visible else comfort.visible.dropLast(1)
        val keptSoil=soilContext.substringBefore("\n余思：").takeIf{it.startsWith("当前：")}?.removePrefix("当前：").orEmpty()
        val keptAfter=soilContext.substringAfter("余思：\n","").lines().filter{it.startsWith("- ")}.map{it.removePrefix("- ")}
        if(dogtalk!=null&&comfort.dogtalk.isNotEmpty())store.atomic{LocalDogtalkStore(it).consume(dogtalk)}
        return Context(comfort.messages,RemoteDeskSlip(
            comfort=inputPolicy?.note.orEmpty(),
            currentMessage=RemoteDeskCurrentMessage(status=if(currentMessage==null)"未递给"else "已递给",delivered=currentMessage!=null,content=currentMessage?.content.orEmpty()),
            recentContext=RemoteDeskRecentContext(status=if(recent.isEmpty())"未递给"else "已递给",turns=(recent.size+1)/2,currentMessageSeparate=currentMessage!=null,messages=recent),
            dogtalk=RemoteDeskDogtalk(status=if(comfort.dogtalk.isEmpty())"未递给" else "已递给",delivered=comfort.dogtalk.isNotEmpty(),context=comfort.dogtalk),
            summary="本机上下文按在线舒适预算规则组装；回执仅记录实际递入资料；"+recall.retrievalStatus,
            crossWindow=cross.receipt,
            realityContext=real,responseMode=responseMode,
            attachments=attachmentContext.receipt.takeIf{attachmentIds.isNotEmpty()}?.let{it.copy(vision=it.vision.copy(supported=inputPolicy?.vision==true))},
            customInstructions=RemoteDeskCustomInstructions(status=if(instructions.isEmpty())"未设置" else "已递给",delivered=instructions.isNotEmpty(),empty=instructions.isEmpty(),length=instructions.length,content=instructions),
            userPortrait=portraitReceipt("用户画像",userPortrait,comfort.over),
            globalExcerpt=portraitReceipt("自我画像",selfPortrait,comfort.over),
            thinkingSoil=RemoteDeskThinkingSoil(status=if(soilRow!=null&&!soilEnabled)"已关闭" else if(soilContext.isEmpty())"未递给" else "已递给",enabled=soilEnabled,delivered=soilContext.isNotEmpty(),empty=soilContext.isEmpty(),context=soilContext,currentText=keptSoil,afterthoughts=keptAfter,afterthoughtsCount=keptAfter.size),
            worldbook=RemoteDeskWorldbook(status=if(matches.isEmpty())"未命中" else if(deliveredWorld.isEmpty())"预算裁剪"else "已递给",matchedCount=matches.size,deliveredCount=deliveredWorld.size,matchedTitles=matches.map{it.entry.title},deliveredTitles=deliveredWorld.map{it.entry.title},
                entries=matches.mapIndexed{i,m->RemoteDeskWorldbookItem(title=m.entry.title,id=m.entry.id,matchedKeywords=m.keywords,content=m.entry.content,scope=m.entry.scope,matchedBy=m.by,delivered=i<deliveredWorld.size,deliveredText=if(i<deliveredWorld.size)m.entry.content else "")}),
            relatedMemory=RemoteDeskMemory(status=if(memories.isEmpty())"未命中" else if(deliveredMemory.isEmpty())"预算裁剪"else "已递给",confirmationStatus="仅已确认的 active / dormant 记录",count=deliveredMemory.size,
                items=deliveredMemory.mapIndexed{i,e->RemoteDeskMemoryItem(title=e.title,id=e.id,entryType=e.entryType,tag=e.tag,sourceModel=e.sourceModel,sourceWindow=e.sourceWindow,sourceDate=e.sourceDate,reason=recall.reasons[e.id]?:"本机关键词命中",lifeCore=e.lifeCore,usageHint=e.usageHint,avoidHint=e.avoidHint,content=e.content,deliveredText=memoryText[i])}),
            contextBudget=RemoteDeskContextBudget(estimatedTokens=comfort.estimated,comfortCeiling=comfort.ceiling,trimmed=comfort.trimmed>0,trimmedCount=comfort.trimmed,exceedsComfortCeiling=comfort.over,
                sourcesPreserved=(if(recent.isEmpty())emptyList()else listOf("recent_context"))+(if(currentMessage==null)emptyList()else listOf("current_message"))+(if(real.delivered)listOf("reality_context")else emptyList())+(if(responseMode.delivered)listOf("response_mode")else emptyList())+(if(soilContext.isNotEmpty())listOf("thinking_soil")else emptyList())+(if(cross.receipt.delivered)listOf("cross_window")else emptyList())+(if(comfort.dogtalk.isNotEmpty())listOf("dogtalk")else emptyList())+(if(instructions.isEmpty())emptyList()else listOf("custom_instructions"))+(if(deliveredWorld.isEmpty())emptyList()else listOf("worldbook"))+(if(deliveredMemory.isEmpty())emptyList()else listOf("related_memory"))+(if(userPortrait.isEmpty())emptyList()else listOf("user_portrait"))+(if(selfPortrait.isEmpty())emptyList()else listOf("global_excerpt")),userPortrait=portraitStatus(userPortrait,comfort.over),globalExcerpt=portraitStatus(selfPortrait,comfort.over))
        ),attachmentContext.imageParts)
    }
    fun imageTool(cid:String,tid:String,uid:String,mid:String,providers:LocalProviderStore,vision:Boolean?,sequenceId:String?=null):LocalImageTool?{
        if(surfaceFor(cid) !in setOf("main_chat","radio")||cache.history(cid)?.contextSettings?.localModelWriteEnabled!=true)return null
        val selected=cache.profile()?.currentImageModel.orEmpty()
        if(selected.isBlank()||providers.resolveImageProvider(selected)==null)return null
        return LocalImageTool(store,providers::resolveImageProvider,cid,tid,uid,mid,selected,vision,sequenceId)
    }
    fun toolSession(cid:String,turn:String,request:RemoteCrossWindowRequest?,receipt:RemoteDeskSlip,modelId:String="",wireLimit:Int?=null,image:LocalImageTool?=null,messageId:String?=null,sequenceId:String?=null)=LocalToolSession.open(store,cid,turn,request,receipt,modelId,wireLimit,web,voice,image,messageId,sequenceId)
    private fun portraitStatus(body:String,over:Boolean)=if(body.isEmpty())"empty"else if(over)"over_budget"else "complete"
    private fun portraitReceipt(label:String,body:String,over:Boolean)=RemoteDeskGlobalExcerpt(label=label,status=if(body.isEmpty())"未设置" else "已递给",delivered=body.isNotEmpty(),injection=if(body.isEmpty())"none" else if(over)"over_budget"else "full",estimatedTokens=LocalContextPolicy.estimate(body),length=body.length,content=body)
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
