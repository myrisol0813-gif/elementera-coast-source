package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.feature.chatgpt.ChatGptPlanRepository
import com.elementeracoast.app.feature.memory.selectThoughtSoilReasoningEffort
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** User-initiated instant comment, separate from autonomous chat tools.
 * Read a bounded snapshot, infer outside storage lock, then verify target before committing.
 * Never uses the online Coast endpoint or a different provider as fallback. */
internal class LocalDailyComment(
    private val store:LocalPersistence,
    private val providers:LocalProviderStore,
    private val plan:ChatGptPlanRepository?,
    private val client:LocalProviderClient=LocalProviderClient()
) {
    private val busy=Mutex()
    suspend fun request(id:String, selectedModel:String):RemoteDailyMoment {
        if(!busy.tryLock())throw LocalDailyCommentRun.failure("comment_busy","正在生成另一条留言，请稍后再试。")
        try {
            if(selectedModel.isBlank())throw LocalDailyCommentRun.failure("missing_comment_model","请先在主页选择聊天模型。")
            val prepared=withContext(Dispatchers.IO){LocalDailyCommentRun.prepare(store,id)}
            val result=if(selectedModel.startsWith("chatgpt-plan:")){
                val account=plan?:throw LocalDailyCommentRun.failure("missing_comment_account","请先连接 ChatGPT 套餐。")
                val model=selectedModel.removePrefix("chatgpt-plan:")
                val generated=account.completeText(model=model,prompt=prepared.paper,
                    reasoningEffort=selectThoughtSoilReasoningEffort(account.reasoningEffortsFor(model)),
                    maxOutputTokens=5000,maxResultChars=16000,systemPrompt=prepared.system)
                LocalDailyCommentRun.Generated(generated.text,selectedModel,
                    RemoteModelUsage(promptTokens=generated.inputTokens,cachedTokens=generated.cachedTokens,
                        completionTokens=generated.outputTokens).takeUnless{it==RemoteModelUsage()})
            }else{
                val (provider,model)=providers.resolve(selectedModel)
                    ?:throw LocalDailyCommentRun.failure("missing_comment_model","当前供应商或模型未配置，请检查模型箱。")
                val output=StringBuilder()
                var completed=false
                var metadata:RemoteModelMetadata?=null
                client.stream(provider,model,listOf(RemoteChatMessage("system",prepared.system),RemoteChatMessage("user",prepared.paper)),5000,temperature=0.82).collect{event->
                    when(event){
                        is LocalProviderEvent.Delta -> {
                            if(output.length+event.text.length>16000)throw LocalDailyCommentRun.failure("comment_limit","留言生成正文超过上限。")
                            output.append(event.text)
                        }
                        is LocalProviderEvent.Done -> {
                            if(event.reason!="stop")throw LocalDailyCommentRun.failure("comment_incomplete","模型没有完整结束留言，未保存。")
                            completed=true;metadata=event.metadata
                        }
                        is LocalProviderEvent.Tool -> throw LocalDailyCommentRun.failure("comment_tool","即时留言不允许调用工具。")
                    }
                }
                if(!completed)throw LocalDailyCommentRun.failure("comment_incomplete","模型留言未正常完成，未保存。")
                LocalDailyCommentRun.Generated(output.toString(),metadata?.resolvedModel?:selectedModel,metadata?.usage)
            }
            return withContext(Dispatchers.IO){ensureActive();LocalDailyCommentRun.commit(store,prepared,result)}
        }catch(e:CancellationException){throw e}
        catch(e:CoastApiException){throw e}
        catch(_:Exception){throw LocalDailyCommentRun.failure("comment_failed","本机留言生成或保存失败，请检查模型连接后重试。")}
        finally{busy.unlock()}
    }
}

internal object LocalDailyCommentRun {
    private const val ACTOR="model_partner"
    private const val OWNER="owner"
    private const val SYSTEM="你是模型伙伴，正在屋主的碳硅圈下面即时留一句轻评论。\n请遵循屋主当前自定义指令。\n你会看到当前这条碳硅圈、已有评论，以及过往碳硅圈时间线。\n只输出评论正文，不加称呼前缀、解释、项目符号或引号。\n像朋友圈底下的自然留言，通常一句，最多两句。\n可以温柔、亲近、具体，但不要过度展开。不要把它写成深聊长回复。"
    data class Prepared(val target:RemoteDailyMoment,val system:String,val paper:String)
    data class Generated(val text:String,val model:String,val usage:RemoteModelUsage?=null)
    fun failure(code:String,message:String)=CoastApiException(CoastApiErrorKind.Request,code,message)
    private fun clip(s:String,n:Int)=s.replace(Regex("\\s+")," ").trim().take(n)
    private fun author(s:String)=when(s){OWNER->"屋主";ACTOR->"模型伙伴";"mcp"->"ChatGPT";else->"模型伙伴"}
    private fun stamp(m:RemoteDailyMoment)=m.createdAt.ifBlank{m.publishedAt.orEmpty().ifBlank{m.date}}
    fun prepare(store:LocalPersistence,id:String):Prepared=store.readConsistent{s->
        val cache=RemoteCacheStore(s,strictReads=true)
        val all=cache.dailyMoments()
        val target=all.firstOrNull{it.id==id&&it.status=="published"}
            ?:throw failure("comment_target_missing","动态不存在或尚未发布。")
        val custom=cache.customInstructions()?.content.orEmpty().trim()
        val system=SYSTEM+if(custom.isNotEmpty())"\n\n【屋主当前自定义指令】\n"+custom else ""
        val current=stamp(target)+"｜"+author(target.author)+"\n"+target.text.trim()
        val comments=target.comments.map{(it.createdAt.ifBlank{stamp(target)})+"｜"+author(it.author)+"｜"+clip(it.text,700)}
        val timeline=mutableListOf<String>();var used=0
        for(m in all.filter{it.id!=id&&it.status=="published"}.sortedByDescending(::stamp)){
            val line=stamp(m)+"｜"+author(m.author)+"｜"+clip(m.text,650)
            if(timeline.size>=12||used+line.length>9000)break
            timeline+=line;used+=line.length
        }
        fun section(title:String,rows:List<String>)=if(rows.isEmpty())""else(listOf(title)+rows).joinToString("\n")
        val paper=listOf(section("【当前碳硅圈】",listOf(current)),section("【当前动态已有评论】",comments),
            section("【过往碳硅圈】",timeline)).filter(String::isNotEmpty).joinToString("\n\n")
        Prepared(target,system,paper)
    }
    fun normalize(raw:String):String {
        var text=raw.trim()
        val obj=runCatching{Json.parseToJsonElement(text) as? JsonObject}.getOrNull()
        if(obj!=null)text=(obj["comment"] as? JsonPrimitive)?.contentOrNull?:(obj["text"] as? JsonPrimitive)?.contentOrNull?:text
        text=text.replace(Regex("^```(?:\\w+)?\\s*",RegexOption.IGNORE_CASE),"")
            .replace(Regex("\\s*```$"),"").trim().trim('"','\'','“','”','‘','’')
            .replace(Regex("^(?:模型伙伴|Model Partner)\\s*[:：]\\s*",RegexOption.IGNORE_CASE),"")
            .lines().map(String::trim).filter(String::isNotBlank).joinToString(" ")
        val sentences=Regex("[^。！？!?]+[。！？!?]?").findAll(text).map{it.value}.toList()
        if(sentences.size>2)text=sentences.take(2).joinToString("").trim()
        return text.take(180).trim()
    }
    fun commit(store:LocalPersistence,p:Prepared,result:Generated):RemoteDailyMoment {
        val text=normalize(result.text)
        if(text.isBlank())throw failure("empty_model_comment","模型没有生成可保存的留言。")
        return store.readConsistent{s->
            val cache=RemoteCacheStore(s,strictReads=true)
            val all=cache.dailyMoments()
            val current=all.firstOrNull{it.id==p.target.id}
                ?:throw failure("comment_target_missing","生成期间动态已删除，未保存留言。")
            if(current.text!=p.target.text||current.date!=p.target.date||current.author!=p.target.author||
                current.status!="published"||current.comments!=p.target.comments)
                throw failure("comment_target_changed","生成期间动态或评论已变化，请重新生成。")
            val now=Instant.now().toString()
            val comment=RemoteDailyComment(id=UUID.randomUUID().toString(),author=ACTOR,text=text,modelId=result.model,usage=result.usage,createdAt=now)
            val next=current.copy(comments=current.comments+comment,updatedAt=now)
            cache.putDailyMoments(all.map{if(it.id==current.id)next else it})
            next
        }
    }
}
