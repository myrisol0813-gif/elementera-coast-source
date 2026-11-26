package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class LocalImageProviderTest{
    @Test fun freeDiscoveryAndExplicitCostAuthorization(){
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0)
        var calls=0
        val client=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();calls++
            assertEquals("openrouter.ai",r.url.host)
            val value=if(r.url.encodedPath.endsWith("/models"))"""{"data":[{"id":"fixture/paid","architecture":{"output_modalities":["image"]}},{"id":"fixture/free:free","architecture":{"output_modalities":["image"]}},{"id":"fixture/text:free","architecture":{"output_modalities":["text"]}}]}""" else {
                assertEquals("/api/v1/images",r.url.encodedPath);assertEquals("Bearer fixture-key",r.header("Authorization"))
                val buf=Buffer();r.body!!.writeTo(buf)
                val payload=Json.parseToJsonElement(buf.readUtf8()).jsonObject
                assertEquals(setOf("model","prompt","n"),payload.keys)
                assertEquals("fixture/free:free",payload["model"]!!.jsonPrimitive.content)
                assertEquals("one drawing",payload["prompt"]!!.jsonPrimitive.content)
                buildJsonObject{
                    put("model","fixture/free:free");put("data",JsonArray(listOf(buildJsonObject{put("b64_json",Base64.getEncoder().encodeToString(png))})))
                    put("usage",buildJsonObject{put("cost",0)})
                }.toString()
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(value.toResponseBody()).build()
        }.build()
        val provider=LocalImageProvider(client)
        assertEquals(listOf("fixture/free:free","fixture/paid"),provider.discover().map{it.id})
        val config=LocalImageProvider.Config("fixture-key","fixture/free:free")
        val input=buildJsonObject{put("prompt","one drawing")}
        val result=provider.generate(config,input)
        assertArrayEquals(png,result.bytes);assertEquals("image/png",result.mime);assertEquals("fixture/free:free",result.reportedModel);assertEquals(0.0,result.costUsd!!,0.0)
        val rejected=runCatching{provider.generate(config.copy(model="fixture/paid"),input)}.exceptionOrNull() as LocalImageProvider.Failure
        assertEquals("paid_not_authorized",rejected.code)
        assertTrue(runCatching{provider.generate(config,buildJsonObject{put("prompt","x");put("history","private")})}.isFailure)
        assertEquals(2,calls)
        assertFalse(config.toString().contains("fixture-key"))
    }

/** Private wire-only continuation from a verified saved original, never a
 * persisted human message. Prepared is not a claim of provider delivery. */
internal class GeneratedImageReadback(val receipt:JsonObject,val continuationMessage:JsonObject?){
    override fun toString()="GeneratedImageReadback(receipt="+receipt+", continuation=redacted)"
}
internal fun prepareGeneratedImageReadback(attachmentId:String,bytes:ByteArray,mime:String,visionSupported:Boolean?):GeneratedImageReadback{
    require(Regex("[A-Za-z0-9_.:-]{1,160}").matches(attachmentId)){"缺少已保存图像原件的标识。"}
    require(bytes.size in 1..8*1024*1024){"图像原件缺失或超限。"}
    fun starts(vararg signature:Int,offset:Int=0)=signature.indices.all{i->bytes.getOrNull(i+offset)?.toInt()?.and(255)==signature[i]}
    val detected=when{
        bytes.size>=24&&starts(137,80,78,71,13,10,26,10)->"image/png"
        bytes.size>=4&&starts(255,216,255)->"image/jpeg"
        bytes.size>=16&&starts(82,73,70,70)&&starts(87,69,66,80,offset=8)->"image/webp"
        else->null
    }
    require(detected!=null&&mime==detected){"图像原件 MIME 与内容不符。"}
    val receipt=buildJsonObject{put("attachment_id",attachmentId);put("status",when(visionSupported){true->"prepared";false->"model_no_vision";null->"vision_unknown"})}
    if(visionSupported!=true)return GeneratedImageReadback(receipt,null)
    val message=buildJsonObject{
        put("role","user")
        put("content",JsonArray(listOf(
            buildJsonObject{put("type","text");put("text","【生成图像回读 · 系统转交】这是本轮图像工具生成的已保存作品原件，并非人类新发言。请根据实际像素继续回应。")},
            buildJsonObject{put("type","image_url");put("image_url",buildJsonObject{put("url","data:"+mime+";base64,"+Base64.getEncoder().encodeToString(bytes))})}
        )))
    }
    return GeneratedImageReadback(receipt,message)
}
}
