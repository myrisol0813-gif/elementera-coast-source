package com.elementeracoast.app.core.local

import android.content.Context
import com.elementeracoast.app.core.remote.RemoteCacheStore
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Explicitly configured independent speech provider. No bundled voice ID. */
class LocalVoiceProvider(
    private val config:()->LocalProviderConfig?,
    private val http:OkHttpClient=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectTimeout(10,TimeUnit.SECONDS).callTimeout(45,TimeUnit.SECONDS).build()
){
    constructor(context:Context):this({LocalProviderStore(context,voiceOnly=true).load().firstOrNull{it.id=="elevenlabs"}})
    data class Generated(val voiceId:String,val text:String,val bytes:ByteArray)
    fun configured()=runCatching{config()?.let{it.apiKey.isNotBlank()&&it.models.singleOrNull()?.matches(VOICE_ID)==true}==true}.getOrDefault(false)
    fun generate(raw:String):Generated {
        val text=raw.trim();require(text.length in 1..2400){"语音文字须为1—2400字符。"}
        val p=config()?:throw VoiceFailure("voice_not_configured","请在模型箱配置本机语音。",503)
        val voice=p.models.singleOrNull()?.takeIf{it.matches(VOICE_ID)}?:throw VoiceFailure("voice_not_configured","请配置有效的Voice ID。",503)
        if(p.apiKey.isBlank())throw VoiceFailure("voice_not_configured","请配置语音API Key。",503)
        val payload=buildJsonObject{put("text",text);put("model_id","eleven_multilingual_v2")}
        val request=Request.Builder().url("https://api.elevenlabs.io/v1/text-to-speech/"+voice+"?output_format=mp3_44100_128")
            .header("xi-api-key",p.apiKey).header("Accept","audio/mpeg")
            .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
        try{
            http.newCall(request).execute().use{res->
                if(!res.isSuccessful)throw VoiceFailure("voice_provider_failed","语音供应商返回HTTP "+res.code+"，请检查额度和权限。",502)
                val b=res.body?:throw VoiceFailure("voice_empty","供应商没有返回音频。",502)
                if(b.contentLength()>MAX_BYTES||b.source().request(MAX_BYTES+1))throw VoiceFailure("audio_limit","音频超过4MiB，未保存。",413)
                val bytes=b.source().readByteArray()
                val id3=bytes.size>=10&&bytes[0]==73.toByte()&&bytes[1]==68.toByte()&&bytes[2]==51.toByte()
                val frame=bytes.size>=4&&(bytes[0].toInt() and 255)==255&&(bytes[1].toInt() and 224)==224
                if(!id3&&!frame)throw VoiceFailure("voice_invalid_audio","供应商未返回可识别的MP3，未保存。",502)
                if(config()!=p)throw VoiceFailure("voice_config_changed","生成期间语音配置已变化，未保存。",409)
                return Generated(voice,text,bytes)
            }
        }catch(e:VoiceFailure){throw e}catch(_:Exception){throw VoiceFailure("voice_provider_unavailable","语音供应商连接失败或超时；未保存音频。",502)}
    }
    companion object {
        internal val VOICE_ID=Regex("[A-Za-z0-9_-]{8,80}")
        const val MAX_BYTES=4L*1024*1024
    }
}
internal class VoiceFailure(val type:String,override val message:String,val status:Int):IllegalStateException(message)

internal fun saveLocalVoice(s:LocalPersistence,cid:String,turn:String?,message:String?,source:String,model:String?,audio:LocalVoiceProvider.Generated,recordId:String="voice_"+UUID.randomUUID()):JsonObject {
    val side=LocalSideRecords(s)
    val data=buildJsonObject{
        put("id",recordId);put("conversation_id",cid);put("turn_id",turn?.let(::JsonPrimitive)?:JsonNull);put("message_id",message?.let(::JsonPrimitive)?:JsonNull)
        put("source",source);put("model_label",model?.take(180)?.let(::JsonPrimitive)?:JsonNull);put("voice_id",audio.voiceId);put("text",audio.text);put("audio_bytes",audio.bytes.size);put("created_at",System.currentTimeMillis())
    }
    val row=LocalSideRecords.Row("voice",data,ArchiveV2Chunks.digest(audio.bytes))
    side.putOriginal(row,audio.bytes);side.save(side.rows()+row)
    return data
}

internal fun generateLocalManualVoice(store:LocalPersistence,provider:LocalVoiceProvider,input:JsonObject):JsonObject {
    require(input.keys==setOf("conversation_id","message_id","paragraph_indices"))
    fun str(k:String)=input.getValue(k).jsonPrimitive.let{require(it.isString);it.content}
    val cid=str("conversation_id");val mid=str("message_id")
    val indices=input.getValue("paragraph_indices").jsonArray.map{require(it is JsonPrimitive&&!it.isString);it.int}
    require(indices.size in 1..40&&indices.distinct().size==indices.size)
    fun selection(s:LocalPersistence):Triple<String,String,String?> {
        val cache=RemoteCacheStore(s,strictReads=true)
        require(cache.conversations().any{it.id==cid&&it.deletedAt==null}){"原窗口不存在。"}
        val h=cache.history(cid)?:error("原窗口不存在。")
        val t=h.turns.firstOrNull{it.assistant.variantsByUserVariant.values.flatten().any{v->v.id==mid&&!v.hidden}}?:error("原助手消息不存在。")
        val v=t.assistant.variantsByUserVariant.values.flatten().first{it.id==mid&&!it.hidden}
        val paragraphs=LocalSideRecords.paragraphs(v.content)
        require(indices.all{it in paragraphs.indices})
        require(LocalSideRecords(s).clips(cid).count{it["message_id"]?.jsonPrimitive?.contentOrNull==mid}<12){"同一消息最多12段语音。"}
        return Triple(t.id,indices.sorted().joinToString("\n\n"){paragraphs[it]},v.modelId)
    }
    val selected=store.readConsistent{selection(it)}
    val audio=provider.generate(selected.second)
    return store.atomic{s->
        require(selection(s)==selected&&provider.configured()){"原消息或语音授权已变化，未保存。"}
        saveLocalVoice(s,cid,selected.first,mid,"manual",selected.third,audio)
    }
}
