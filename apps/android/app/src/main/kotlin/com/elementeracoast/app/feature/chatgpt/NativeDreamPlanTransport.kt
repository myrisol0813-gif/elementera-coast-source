package com.elementeracoast.app.feature.chatgpt

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Only returns a sanitized error code. No access token, stream body or raw
 * reasoning is ever written into an exception or activity receipt. */
internal class NativeDreamPlanFailure(val reason:String,val httpStatus:Int?=null):Exception(reason)

/** A single completed step. Calling code must hold the persisted ledger
 * reservation and revalidate the window and grant before every transmission.
 * This is deliberately not connected to the live scheduler until verified. */
internal class NativeDreamPlanTransport(private val account:ChatGptPlanRepository,private val base:OkHttpClient=OkHttpClient()){
    suspend fun request(grant:NativeDreamPlanProtocol.Grant,window:String,revision:String,modelId:String,
                        body:JsonObject,exposed:Set<String>,authorize:suspend ()->Boolean):NativeDreamPlanProtocol.Step{
        require(body["model"]==JsonPrimitive(NativeDreamPlanProtocol.slug(modelId))&&body["store"]==JsonPrimitive(false)&&body["stream"]==JsonPrimitive(true))
        require(body.keys.all{it in setOf("model","input","instructions","store","stream","include","tools")})
        require(authorize())
        val sent=AtomicBoolean(false)
        val client=base.newBuilder().retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false)
            .addNetworkInterceptor{chain->
                if(!sent.compareAndSet(false,true))throw IOException("plan autonomous replay blocked")
                chain.proceed(chain.request())
            }.callTimeout(120,TimeUnit.SECONDS).build()
        return callbackFlow<NativeDreamPlanProtocol.Step>{
            val active=AtomicReference<okhttp3.Call?>()
            val job=launch(Dispatchers.IO){
                try{
                    val token=account.accessTokenForDream(grant,window,revision,modelId)
                    if(!authorize())throw NativeDreamPlanFailure("plan_authorization_unavailable")
                    val request=Request.Builder().url(NativeDreamPlanProtocol.ENDPOINT)
                        .header("Authorization","Bearer "+token).header("Accept","text/event-stream")
                        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
                    val call=client.newCall(request);active.set(call)
                    call.execute().use{response->
                        if(!response.isSuccessful){
                            val raw=response.peekBody(65536).string()
                            val error=runCatching{Json.parseToJsonElement(raw).jsonObject["error"] as? JsonObject}.getOrNull()
                            val code=(error?.get("code") as? JsonPrimitive)?.contentOrNull
                            throw NativeDreamPlanFailure(NativeDreamPlanProtocol.failure(response.code,code),response.code)
                        }
                        val source=requireNotNull(response.body).source()
                        val stream=NativeDreamPlanStream(exposed)
                        var completed:NativeDreamPlanProtocol.Step?=null
                        var bytes=0L
                        while(!source.exhausted()){
                            ensureActive()
                            val line=source.readUtf8LineStrict(2097152)
                            bytes+=line.toByteArray().size+1
                            if(bytes>8L*1024*1024)throw NativeDreamPlanFailure("plan_response_too_large")
                            val step=stream.line(line)
                            if(step!=null){completed=step;break}
                        }
                        send(completed?:stream.finish()?:throw NativeDreamPlanFailure("plan_request_unconfirmed"))
                    }
                    close()
                }catch(e:CancellationException){throw e}
                catch(e:NativeDreamPlanFailure){close(e)}
                catch(e:java.io.InterruptedIOException){close(NativeDreamPlanFailure("plan_request_timeout"))}
                catch(e:IOException){close(NativeDreamPlanFailure("plan_network_error"))}
                catch(e:kotlinx.serialization.SerializationException){close(NativeDreamPlanFailure("plan_response_decode_error"))}
                catch(e:IllegalArgumentException){close(NativeDreamPlanFailure("plan_invalid_response"))}
                catch(_:Exception){close(NativeDreamPlanFailure("plan_request_unconfirmed"))}
                finally{active.getAndSet(null)?.cancel()}
            }
            awaitClose{active.getAndSet(null)?.cancel();job.cancel()}
        }.first()
    }
}

/** Parse SSE framing independently of transport; only response.completed
 * authorizes normalization, never partial delta or function arguments. */
internal class NativeDreamPlanStream(private val exposed:Set<String>){
    private val data=mutableListOf<String>()
    private val streamed=mutableMapOf<Int,JsonObject>()
    private var ended=false
    fun line(line:String):NativeDreamPlanProtocol.Step?{
        check(!ended)
        if(line.isEmpty())return flush()
        if(line.startsWith("data:"))data.add(line.removePrefix("data:").removePrefix(" "))
        return null
    }
    fun finish():NativeDreamPlanProtocol.Step?=if(ended)null else flush()
    private fun flush():NativeDreamPlanProtocol.Step?{
        if(data.isEmpty())return null
        val raw=data.joinToString("\n");data.clear()
        if(raw=="[DONE]"){ended=true;return null}
        val event=Json.parseToJsonElement(raw).jsonObject
        completedNativeStreamItem(event)?.let{(index,item)->streamed[index]=item}
        return when(event["type"]?.jsonPrimitive?.contentOrNull){
            "response.completed"->{ended=true;NativeDreamPlanProtocol.complete(event.getValue("response").jsonObject,streamed,exposed)}
            "response.failed","response.incomplete","error"->{
                ended=true
                val error=((event["response"] as? JsonObject)?.get("error") as? JsonObject)?:event
                val code=(error["code"] as? JsonPrimitive)?.contentOrNull
                throw NativeDreamPlanFailure(NativeDreamPlanProtocol.failure(0,code))
            }
            else->null
        }
    }
}
