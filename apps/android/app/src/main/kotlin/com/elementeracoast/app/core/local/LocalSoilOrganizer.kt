package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.feature.chatgpt.ChatGptPlanRepository
import com.elementeracoast.app.feature.memory.selectThoughtSoilReasoningEffort
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import com.elementeracoast.app.core.network.CoastApiException
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.text.Normalizer
import java.util.Locale
import java.util.UUID

/** A completed interaction is the only automatic organization trigger.
 * Prepare outside the write transaction; verify the exact source and revision at commit. */
internal class LocalSoilOrganizer(
    private val store: LocalPersistence,
    private val providers: LocalProviderStore,
    private val plan: ChatGptPlanRepository?,
    private val client: LocalProviderClient = LocalProviderClient()
) {
    suspend fun organize(conversationId: String, modelId: String) {
        val prepared = try { withContext(Dispatchers.IO) { LocalSoilRun.prepare(store, conversationId, modelId) } } catch(e:CancellationException){throw e} catch(_:Exception){throw LocalSoilFailure("准备整理资料失败")} ?: return
        val result = try { if (modelId.startsWith("chatgpt-plan:")) {
            val account = requireNotNull(plan) { "请先连接 ChatGPT 套餐。" }
            val model = modelId.removePrefix("chatgpt-plan:")
            val effort = selectThoughtSoilReasoningEffort(account.reasoningEffortsFor(model))
            account.completeText(model = model, prompt = prepared.prompt, reasoningEffort = effort,
                maxOutputTokens = null, maxResultChars = LocalSoilRun.MAX_RESULT).text
        } else {
            val (provider, model) = requireNotNull(providers.resolve(modelId)) { "整理模型未配置。" }
            val policy=client.soilPolicy(provider,model)
            collectLocalSoilReply(prepared.prompt,policy.firstBudget,policy.retryBudget,{ LocalSoilRun.validate(prepared,it) }) { prompt,budget ->
                client.organize(provider,model,prompt,budget,policy)
            }
        }
        } catch(e:CancellationException){throw e} catch(e:LocalSoilFailure){throw e} catch(e:CoastApiException){throw LocalSoilFailure(if(e.status>0)"供应商请求失败（HTTP ${e.status}）"else "供应商整理请求或流式响应失败")} catch(_:Exception){throw LocalSoilFailure("供应商整理请求未完成")}
        withContext(Dispatchers.IO) { LocalSoilRun.commit(store, prepared, result) }
    }
}

internal class LocalSoilFailure(val detail:String):IllegalArgumentException(detail)

internal const val LOCAL_SOIL_FIRST_OUTPUT_TOKENS = 8192
internal const val LOCAL_SOIL_RETRY_OUTPUT_TOKENS = 16384

private class LocalSoilOutputLimit:IllegalArgumentException()

/** At most two requests. Only an explicit length finish or invalid JSON permits retry.
 * Each attempt is isolated: no truncated JSON, candidate or cursor is committed. */
internal suspend fun collectLocalSoilReply(
    prompt:String,
    firstBudget:Int=LOCAL_SOIL_FIRST_OUTPUT_TOKENS,
    retryBudget:Int=LOCAL_SOIL_RETRY_OUTPUT_TOKENS,
    validate:(String)->Unit={},
    stream:(String,Int)->kotlinx.coroutines.flow.Flow<LocalProviderEvent>
):String {
    suspend fun attempt(text:String,budget:Int):String {
        val output=StringBuilder()
        var complete=false
        stream(text,budget).collect { event ->
            when(event) {
                is LocalProviderEvent.Delta -> {
                    if(output.length+event.text.length>LocalSoilRun.MAX_RESULT)
                        throw LocalSoilFailure("整理正文超过保存上限")
                    output.append(event.text)
                }
                is LocalProviderEvent.Tool -> throw LocalSoilFailure("整理不允许调用工具")
                is LocalProviderEvent.Done -> {
                    if(event.reason=="length")throw LocalSoilOutputLimit()
                    if(event.reason!="stop")throw LocalSoilFailure(if(event.reason=="content_filter")"供应商截断了整理输出"else "供应商没有正常结束整理")
                    complete=true
                }
            }
        }
        if(!complete)throw LocalSoilFailure("供应商整理流未正常完成")
        return output.toString().also(validate)
    }
    val retryPrompt=try {
        return attempt(prompt,firstBudget)
    }catch(_:LocalSoilOutputLimit){
        prompt+"\n上一次输出达到供应商上限。请减少重复与非必要候选，尽快返回完整闭合的 JSON。保留真正需要承接的内容。"
    }catch(e:LocalSoilFailure){
        if(e.detail!="整理回包格式不符合约定")throw e
        prompt+"\n上一次输出不是合法整理 JSON。请只返回一个完整 JSON 对象，不要解释。"
    }
    return try{attempt(retryPrompt,retryBudget)}
    catch(_:LocalSoilOutputLimit){throw LocalSoilFailure("供应商达到整理输出上限（已尝试 $firstBudget / $retryBudget token）")}
}

/** Pure preparation and validated canonical persistence shared by both inference paths. */
internal object LocalSoilRun {
    const val MAX_RESULT = 16000
    private const val MAX_PORTRAIT = 12000
    private val modules = listOf("user_portrait", "self_portrait")
    private val textFields = setOf("current_text", "afterthoughts", "memory_candidates", "seed_candidates", "user_portrait", "self_portrait")
    data class Turn(val id: String, val user: RemoteVariant, val assistant: RemoteVariant)
    data class Prepared(
        val cid: String, val model: String, val row: JsonObject, val history: List<RemoteTurn>,
        val turns: List<Turn>, val portraitRoots: Map<String, JsonObject?>, val prompt: String
    )
    private fun JsonObject.str(k: String) = get(k)?.jsonPrimitive?.contentOrNull.orEmpty()
    private fun JsonObject.enabled(k: String) = get(k)?.jsonPrimitive?.intOrNull == 1
    private fun strictText(v: JsonElement?, max: Int): String {
        require(v is JsonPrimitive && v.isString && v.content.length <= max) { "整理文本格式或长度无效。" }
        return v.content.trim()
    }
    private fun array(v: JsonElement?, max: Int): JsonArray {
        require(v is JsonArray && v.size <= max) { "整理数组格式或数量无效。" }
        return v
    }
    private fun clip(text:String,max:Int):String {
        val count=text.codePointCount(0,text.length)
        return if(count<=max)text else text.substring(0,text.offsetByCodePoints(0,max))
    }
    private fun active(history: List<RemoteTurn>): List<Turn> = history.mapNotNull { t ->
        val key = t.user.active.toString()
        val u = t.user.variants.getOrNull(t.user.active) ?: return@mapNotNull null
        val a = t.assistant.variantsByUserVariant[key].orEmpty().getOrNull(t.assistant.activeByUserVariant[key] ?: 0)
            ?: return@mapNotNull null
        if (u.hidden || u.inputType == "landing_letter" || a.hidden || a.content.isBlank() ||
            a.finishReason in setOf("cancelled", "error") || !a.errorDetail.isNullOrBlank()) null else Turn(t.id,u,a)
    }
    fun prepare(store: LocalPersistence, cid: String, model: String): Prepared? = store.readConsistent { s ->
        val row = LocalSoilStore(s).current(cid) ?: return@readConsistent null
        if (!row.enabled("auto_refresh_enabled") || row.enabled("manual_locked")) return@readConsistent null
        val history = RemoteCacheStore(s, strictReads = true).history(cid)?.turns ?: return@readConsistent null
        val all = active(history)
        val latest = all.lastOrNull() ?: return@readConsistent null
        require(latest.assistant.modelId == model) { "整理模型与本轮实际模型不一致。" }
        if (row.str("source_assistant_id") == latest.assistant.id) return@readConsistent null
        val cursor = all.indexOfFirst { it.id == row.str("organized_through_turn_id") }
        val previous = all.dropLast(1).lastOrNull()
        val missed = (if (cursor >= 0) all.drop(cursor + 1) else all.takeLast(3))
            .filterNot { it.id == latest.id || it.id == previous?.id }.takeLast(3)
        val portraits = modules.associateWith { LocalPortraitStore(s).read(it)?.root }
        fun digest(t:Turn,limit:Int)=buildJsonObject {
            put("turn_id",t.id)
            put("user",buildJsonObject { put("message_id",t.user.id);put("content",clip(t.user.content,limit)) })
            put("assistant",buildJsonObject { put("message_id",t.assistant.id);put("content",clip(t.assistant.content,limit)) })
        }
        var includedMissed=missed
        var previousLimit=1000
        var after=Json.parseToJsonElement(row.str("afterthoughts_json")).jsonArray
        fun context()=buildJsonObject {
            put("mode","reply_incremental")
            put("old_current_text",row.str("current_text"))
            put("old_afterthoughts",after)
            put("organized_through_turn_id",row.str("organized_through_turn_id"))
            put("latest_turn",digest(latest,6000))
            put("previous_turn_excerpt",previous?.let{digest(it,previousLimit)}?:JsonNull)
            put("missed_since_success",JsonArray(includedMissed.map{digest(it,1000)}))
        }
        if(context().toString().length>28*1024){previousLimit=400;includedMissed=missed.takeLast(1)}
        if(context().toString().length>28*1024)after=JsonArray(after.take(5))
        val inputTurns=(includedMissed+listOfNotNull(previous)+latest).distinctBy{it.id}
        val input=JsonObject(context()+mapOf("portraits" to buildJsonObject {
            for((module,root) in portraits){
                val body=root?.str("body").orEmpty()
                put(if(module=="user_portrait")"user" else "self",buildJsonObject {
                    put("auto_organize_enabled",(root==null || root.enabled("write_enabled")) && body.length<=MAX_PORTRAIT)
                    put("current_body",body.take(MAX_PORTRAIT))
                })
            }
        }))
        val prompt = LocalSoilPrompt.text + input.toString()
        Prepared(cid, model, row, history, inputTurns, portraits, prompt)
    }
    private data class Proposal(val update: Boolean, val body: String, val reason: String, val excerpt: String)
    private data class Candidate(val title: String, val content: String, val refs: JsonArray, val excerpt: String)
    private data class Parsed(val current: String, val after: JsonArray, val candidates: Map<String,List<Candidate>>, val portraits: Map<String,Proposal>)
    private fun parse(p: Prepared, raw: String): Parsed {
        require(raw.length <= MAX_RESULT) { "整理结果超限。" }
        val clean=raw.trim()
        // Permit a short wrapper, but never rescue a nested object from a truncated root.
        val start=clean.indexOf('{');val end=clean.lastIndexOf('}')
        require(start in 0..240 && end>=start && clean.length-end-1<=240)
        val obj=Json.parseToJsonElement(clean.substring(start,end+1)).jsonObject
        require(obj.keys.all{it in textFields}&&obj.keys.containsAll(setOf("current_text","afterthoughts"))) { "整理结果字段不完整。" }
        val current = strictText(obj["current_text"],4000)
        val after = JsonArray(array(obj["afterthoughts"],7).map { JsonPrimitive(strictText(it,2000)) }.filter { it.content.isNotBlank() })
        val allowed = p.turns.map { it.id }.toSet()
        val latest = p.turns.last()
        val candidates = listOf("memory","seed").associateWith { dest ->
            array(obj[dest+"_candidates"]?:JsonArray(emptyList()),3).map { rawCandidate ->
                val c = rawCandidate.jsonObject
                val content = strictText(c["content"],2000); require(content.isNotBlank())
                val title = strictText(c["title"],120).ifBlank { content.take(120) }
                val refs = array(c["source_refs"]?:JsonArray(emptyList()),8).map { ref ->
                    val o=ref.jsonObject
                    val tid=strictText(o["turn_id"],160);val role=strictText(o["role"],16)
                    require(tid in allowed && role in setOf("user","assistant","turn")) { "整理引用不在本轮输入中。" }
                    buildJsonObject { put("turn_id",tid);put("role",role) }
                }.distinct().ifEmpty { listOf(buildJsonObject { put("turn_id",latest.id);put("role","turn") }) }
                Candidate(title,content,JsonArray(refs),strictText(c["source_excerpt"]?:JsonPrimitive(""),1200))
            }.distinctBy { normalized(it.content) }
        }
        val portraits = modules.associateWith { module ->
            val o=obj[module]?.jsonObject?:return@associateWith Proposal(false,"","","")
            val enabled=p.portraitRoots[module]?.let { it.enabled("write_enabled") && it.str("body").length<=MAX_PORTRAIT } ?: true
            val flag=o.getValue("should_update").jsonPrimitive
            require(!flag.isString)
            val update=flag.boolean
            val body=strictText(o["proposed_body"]?:JsonPrimitive(""),MAX_PORTRAIT)
            require(!update || enabled && body.isNotBlank()) { "画像未授权或候选正文为空。" }
            array(o["source_refs"]?:JsonArray(emptyList()),8).forEach { ref ->
                val source=ref.jsonObject
                require(strictText(source["turn_id"],160) in allowed && strictText(source["role"],16) in setOf("user","assistant","turn"))
            }
            Proposal(update,body,strictText(o["reason"]?:JsonPrimitive(""),4000),strictText(o["source_excerpt"]?:JsonPrimitive(""),1200))
        }
        return Parsed(current,after,candidates,portraits)
    }
    private fun normalized(s:String)=Normalizer.normalize(s,Normalizer.Form.NFKC).lowercase(Locale.SIMPLIFIED_CHINESE).replace(Regex("[\\s\\p{Z}]+")," ").trim()
    private fun snapshot(cid:String, turn:String, assistant:String, row:JsonObject, now:Long)=buildJsonObject {
        put("conversation_id",cid);put("turn_id",turn);put("assistant_message_id",assistant)
        put("current_text",row.str("current_text"));put("afterthoughts_json",row.str("afterthoughts_json"))
        put("revision",row.getValue("revision"));put("model_label",row.str("model_label"))
        put("display_author",row.str("display_author"));put("created_at",now)
    }
    fun validate(p:Prepared,raw:String) { try{parse(p,raw)}catch(_:Exception){throw LocalSoilFailure("整理回包格式不符合约定")} }
    fun commit(store:LocalPersistence,p:Prepared,raw:String) {
        val result=try{parse(p,raw)}catch(_:Exception){throw LocalSoilFailure("整理回包格式不符合约定")}
        // Ordinary soil-only replies need one atomic file write, not a clone of all attachments.
        // Candidate updates span several canonical files and use the existing all-or-nothing transaction.
        val multi=result.candidates.values.any { it.isNotEmpty() } || result.portraits.values.any { it.update }
        try{if(multi)store.atomic { apply(it,p,result) } else store.readConsistent { apply(it,p,result) }}catch(_:Exception){throw LocalSoilFailure("本机保存校验未通过或资料已变化")}
    }
    private fun apply(s:LocalPersistence,p:Prepared,result:Parsed) {
        val soil=LocalSoilStore(s);val rows=soil.read()
        val old=rows.current.singleOrNull { it.str("conversation_id")==p.cid }
        val cache=RemoteCacheStore(s,strictReads=true)
        require(old==p.row && cache.history(p.cid)?.turns==p.history) { "整理期间资料已变化，原思维壤保留。" }
        val portraits=LocalPortraitStore(s)
        require(modules.all { portraits.read(it)?.root==p.portraitRoots[it] }) { "整理期间画像已变化，原资料保留。" }
        val latest=p.turns.last();val now=System.currentTimeMillis()
        val title=cache.conversations().firstOrNull { it.id==p.cid }?.title.orEmpty().take(180)
        val memory=LocalMemoryStore(s);val mem=memory.snapshot();val pockets=mem.pockets.toMutableList()
        val summaries=result.candidates.mapValues { (dest,cs) -> JsonArray(cs.mapNotNull { c ->
            val fingerprint="soil:"+ArchiveV2Chunks.digest((p.cid+"\u0000"+dest+"\u0000"+normalized(c.content)).encodeToByteArray())
            val existing=pockets.firstOrNull { it.str("fingerprint")==fingerprint }
            if(existing!=null && (existing.str("status")!="pending" || existing["deleted_at"]!=JsonNull))return@mapNotNull null
            val id=existing?.str("id")?:UUID.randomUUID().toString()
            val row=buildJsonObject {
                put("id",id);put("conversation_id",p.cid);put("source_type","soil");put("status","pending")
                put("title",c.title);put("life_core",c.content);put("content",c.content)
                for(k in listOf("usage_hint","avoid_hint","suggested_usage_hint","suggested_avoid_hint","tag","migration_status","revision_action"))put(k,"")
                put("source_ref_json",buildJsonObject{put("conversation_id",p.cid);put("candidate_id",id);put("suggested_destination",dest);put("model_label",p.model.take(120));put("source_window",title)}.toString())
                put("recall_count",0);put("last_recalled_at",JsonNull);put("memory_tags_json","[]");put("supersedes_entry_id",JsonNull);put("last_confirmed_at",JsonNull)
                put("source_model",p.model.take(120));put("source_window",title);put("source_time",now)
                put("created_at",existing?.get("created_at")?:JsonPrimitive(now));put("updated_at",now);put("deleted_at",JsonNull)
                put("source_text",c.content);put("suggested_title",c.title);put("suggested_life_core",c.content)
                put("candidate_id",id);put("source_refs_json",c.refs.toString());put("source_excerpt",c.excerpt);put("fingerprint",fingerprint);put("resolved_entry_id",JsonNull)
            }
            if(existing==null)pockets.add(row) // retain prior pending evidence and any user edits
            buildJsonObject { put("candidate_id",id);put("title",c.title);put("content",c.content);put("source_refs",c.refs);put("source_excerpt",c.excerpt) }
        }) }
        val portraitSummaries=result.portraits.mapValues { (module,v) ->
            if(!v.update || v.body==p.portraitRoots[module]?.str("body")) JsonNull else {
                val d=portraits.read(module)?:LocalPortraitStore.Document(buildJsonObject{
                    put("id","global");put("body","");put("write_enabled",1);put("revision",1);put("created_at",now);put("updated_at",now)
                },emptyList(),emptyList())
                val existing=d.candidates.firstOrNull { it.str("proposed_body")==v.body }
                val id=existing?.str("id")?:UUID.randomUUID().toString()
                if(existing==null)portraits.write(module,d.copy(candidates=d.candidates+buildJsonObject{
                    put("id",id);put("proposed_body",v.body);put("change_kind","rewrite");put("reason",v.reason)
                    put("source_conversation_id",p.cid);put("source_message_id",latest.assistant.id);put("source_model",p.model.take(200));put("created_at",now)
                }))
                buildJsonObject { put("candidate_id",id);put("reason",v.reason);put("source_excerpt",v.excerpt) }
            }
        }
        if(pockets!=mem.pockets)memory.write(mem.copy(pockets=pockets))
        val row=JsonObject(p.row+buildJsonObject {
            put("current_text",result.current);put("afterthoughts_json",result.after.toString())
            put("memory_candidates_json",summaries.getValue("memory").toString());put("seed_candidates_json",summaries.getValue("seed").toString())
            put("user_portrait_candidate_json",portraitSummaries.getValue("user_portrait").toString());put("self_portrait_candidate_json",portraitSummaries.getValue("self_portrait").toString())
            put("revision",Math.addExact(p.row.getValue("revision").jsonPrimitive.int,1));put("updated_at",now)
            put("organized_through_turn_id",latest.id);put("source_assistant_id",latest.assistant.id)
            put("actor","native_model_partner");put("surface","native_auto");put("model_label",p.model.take(200));put("display_author",p.model.substringAfterLast('/').take(120))
            put("source_conversation_id",p.cid);put("source_turn_id",latest.id);put("tool_call_id",JsonNull)
        })
        val past=rows.history.toMutableList()
        fun save(turn:String,assistant:String,value:JsonObject,at:Long) {
            if(past.none { it.str("conversation_id")==p.cid && it.str("assistant_message_id")==assistant })
                past.add(snapshot(p.cid,turn,assistant,value,at))
        }
        val prior=p.row.str("source_assistant_id")
        if(prior.isNotBlank() && (p.row.str("current_text").isNotBlank() || p.row.str("afterthoughts_json")!="[]")) {
            val previous=p.history.firstOrNull { t -> t.assistant.variantsByUserVariant.values.flatten().any { it.id==prior } }
            if(previous!=null)save(previous.id,prior,p.row,p.row.getValue("updated_at").jsonPrimitive.long)
        }
        save(latest.id,latest.assistant.id,row,now)
        soil.write(rows.copy(current=rows.current.filterNot { it.str("conversation_id")==p.cid }+row,history=past))
    }
}
