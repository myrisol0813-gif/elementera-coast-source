package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class LocalVoiceProviderTest{
    @Test fun originalBytesAreSavedUnderCanonicalVoiceRecord(){
        var calls=0
        val bytes=byteArrayOf(73,68,51,4,0,0,0,0,0,0,1,2)
        val http=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();calls++
            assertEquals("api.elevenlabs.io",r.url.host);assertEquals("/v1/text-to-speech/fixtureVoice",r.url.encodedPath)
            assertEquals("fixture-key",r.header("xi-api-key"))
            val b=Buffer();r.body!!.writeTo(b);val payload=Json.parseToJsonElement(b.readUtf8()).jsonObject
            assertEquals("second",payload["text"]!!.jsonPrimitive.content)
            assertEquals(setOf("text","model_id"),payload.keys)
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(bytes.toResponseBody()).build()
        }.build()
        val p=LocalVoiceProvider({LocalProviderConfig("elevenlabs","ElevenLabs","https://api.elevenlabs.io","fixture-key",listOf("fixtureVoice"))},http)
        val s=MemoryLocalPersistence();val cache=RemoteCacheStore(s)
        cache.putConversations(listOf(RemoteConversation("c","Fixture")))
        cache.putHistory("c",RemoteHistory(conversationId="c",turns=listOf(RemoteTurn("t",user=RemoteUserBranch(variants=listOf(RemoteVariant("u","user"))),assistant=RemoteAssistantBranches(variantsByUserVariant=mapOf("0" to listOf(RemoteVariant("m","first\n\nsecond"))))))))
        val row=generateLocalManualVoice(s,p,buildJsonObject{put("conversation_id","c");put("message_id","m");put("paragraph_indices",JsonArray(listOf(JsonPrimitive(1))))})
        val side=LocalSideRecords(s);val id=row["id"]!!.jsonPrimitive.content
        assertEquals("t",row["turn_id"]!!.jsonPrimitive.content);assertEquals("m",row["message_id"]!!.jsonPrimitive.content)
        assertEquals("manual",row["source"]!!.jsonPrimitive.content);assertEquals("second",row["text"]!!.jsonPrimitive.content)
        assertArrayEquals(bytes,side.bytes(side.audio(id)!!))
        assertFalse(side.rows().toString().contains("fixture-key"));assertEquals(1,calls)
    }
}
