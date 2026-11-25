package com.elementeracoast.app.core.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.elementeracoast.app.core.remote.RemoteMemoryEntryWriteRequest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class BundledEmbeddingDeviceTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun sha(path:String):String{
        val md=MessageDigest.getInstance("SHA-256")
        context.assets.open(path).use{input->
            val b=ByteArray(65536)
            while(true){val n=input.read(b);if(n<0)break;md.update(b,0,n)}
        }
        return md.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    @Test fun bundledModelAndReferenceRanking(){
        assertEquals("15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc",sha("coast-embedding/model.onnx"))
        assertEquals("45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c",sha("coast-embedding/vocab.txt"))
        assertTrue(context.assets.open("coast-embedding/NOTICE.txt").bufferedReader().use{it.readText()}.contains("MIT License"))
        CoastEmbedding(context).use{engine->
            val q=engine.query("下雨时怎样避免被淋湿")
            val positive=engine.documents("出门前记得拿一把雨伞。").single()
            val negative=engine.documents("这本食谱介绍番茄炒鸡蛋。").single()
            fun cosine(a:FloatArray,b:FloatArray)=a.indices.sumOf{i->a[i].toDouble()*b[i]}
            assertEquals(512,q.size)
            assertEquals(0.5377,cosine(q,positive),0.03)
            assertEquals(0.1955,cosine(q,negative),0.03)
            assertTrue(cosine(q,positive)>cosine(q,negative))
        }
    }
    @Test fun actualLocalStoreRecallAndDeletion(){
        val root=File(context.cacheDir,"embedding-device-"+UUID.randomUUID())
        val store=FileLocalPersistence(File(root,"records"))
        val memory=LocalMemoryStore(store)
        val relevant=memory.save(null,RemoteMemoryEntryWriteRequest("memory","雨伞","出门前记得拿一把雨伞。",status="active"))
        memory.save(null,RemoteMemoryEntryWriteRequest("memory","食谱","这本食谱介绍番茄炒鸡蛋。",status="active"))
        val index=LocalSemanticIndex(File(root,"vectors"),{memory.snapshot().entries},{CoastEmbedding(context)})
        store.semanticIndex=index
        try{
            index.requestRefresh()
            val deadline=System.currentTimeMillis()+90000
            while(!index.progress().startsWith("语义索引就绪")&&System.currentTimeMillis()<deadline)Thread.sleep(100)
            assertEquals("语义索引就绪 · 2/2",index.progress())
            val result=memory.recallDetailed("下雨时怎样避免被淋湿","",explicit=true)
            assertTrue(result.retrievalStatus,result.retrievalStatus.startsWith("混合召回"))
            assertEquals(relevant.id,result.entries.first().id)
            assertEquals("本机语义命中",result.reasons[relevant.id])
            memory.delete(relevant.id)
            assertTrue(memory.recallDetailed("下雨时怎样避免被淋湿","",explicit=true).entries.none{it.id==relevant.id})
        }finally{index.close()}
    }
}
