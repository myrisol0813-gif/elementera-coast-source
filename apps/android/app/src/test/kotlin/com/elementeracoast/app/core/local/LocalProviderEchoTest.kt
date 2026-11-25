package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LocalProviderEchoTest {
    @Test fun cumulativeUsageAndEmptyChoicesAreNotLost(){
        val p=LocalProviderConfig("p","test","https://qianfan.baidubce.com/v2","test-key")
        val e=LocalProviderEcho(p,"ernie-5.5-flash-preview",3200)
        fun observe(s:String)=e.observe(Json.parseToJsonElement(s).jsonObject)
        observe("""{"model":"ernie","choices":[{"delta":{"reasoning_content":"Bearer test-key"}}],"usage":{"prompt_tokens":100,"completion_tokens":1}}""")
        observe("""{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":12,"prompt_tokens_details":{"cached_tokens":40}}}""")
        e.endRound()
        val m=e.metadata("stop")
        assertEquals(100L,m.usage!!.promptTokens)
        assertEquals(12L,m.usage!!.completionTokens)
        assertEquals(40L,m.usage!!.cachedTokens)
        assertFalse(m.reasoningText!!.contains("test-key"))
        assertEquals("ernie",m.resolvedModel)
        e.endRound()
        assertNull(e.metadata("stop").usage)
    }
}
