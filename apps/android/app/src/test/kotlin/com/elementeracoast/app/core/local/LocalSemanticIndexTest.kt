package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class LocalSemanticIndexTest {
    private fun row(id:String,text:String,confirmed:Int=1,deleted:Boolean=false)=buildJsonObject{
        put("id",id);put("title",text);put("life_core",text);put("tag","");put("content","");put("usage_hint","")
        put("user_confirmed",confirmed);put("status","active");put("deleted_at",if(deleted)JsonPrimitive(1) else JsonNull)
    }
    private fun v(i:Int)=FloatArray(512){if(it==i)1f else 0f}
    private fun ready(index:LocalSemanticIndex,expected:String){
        repeat(300){if(index.progress()==expected)return;Thread.sleep(10)}
        fail(index.progress())
    }
    @Test fun contentAddressedIncrementalIndexAndEligibility(){
        val dir=Files.createTempDirectory("coast-vector-test").toFile()
        val calls=AtomicInteger()
        val first=row("a","雨伞");val other=row("b","食谱")
        val pending=row("c","雨伞",confirmed=0);val deleted=row("d","雨伞",deleted=true)
        val rows=AtomicReference(listOf(first,other,pending,deleted))
        val factory={object:CoastVectorEncoder{
            override fun query(text:String)=v(0)
            override fun documents(text:String):List<FloatArray>{calls.incrementAndGet();return listOf(v(if(text.contains("雨伞"))0 else 1))}
            override fun close(){}
        }}
        val index=LocalSemanticIndex(dir,{rows.get()},factory)
        try{
            index.requestRefresh();ready(index,"语义索引就绪 · 2/2")
            assertEquals(2,calls.get())
            val result=index.lookup("下雨",rows.get())
            assertEquals(setOf("a","b"),result.scores.keys)
            assertEquals(1.0,result.scores.getValue("a"),0.001)
            assertEquals(0.0,result.scores.getValue("b"),0.001)
            val edited=row("a","新照片")
            assertFalse(index.lookup("下雨",listOf(edited)).scores.containsKey("a"))
            rows.set(listOf(edited,other,pending,deleted))
            index.requestRefresh()
            repeat(300){if(calls.get()<3)Thread.sleep(10)}
            ready(index,"语义索引就绪 · 2/2");assertEquals(3,calls.get())
            assertEquals(0.0,index.lookup("下雨",listOf(edited)).scores.getValue("a"),0.001)
            assertEquals(2,dir.listFiles()!!.count{it.extension=="vec"})
        }finally{index.close()}
        val reloaded=LocalSemanticIndex(dir,{rows.get()},factory)
        try{reloaded.requestRefresh();ready(reloaded,"语义索引就绪 · 2/2");assertEquals(3,calls.get())}
        finally{reloaded.close();dir.deleteRecursively()}
    }
    @Test fun provisionalSemanticThresholdsPreserveExactTitlePriority(){
        assertEquals(0.0,LocalHybridMemoryRank.semantic(0.1955,false),0.0)
        assertTrue(LocalHybridMemoryRank.semantic(0.5377,false)>=0.74)
        assertTrue(LocalHybridMemoryRank.semantic(0.5396,true)>=0.55)
        assertTrue(LocalHybridMemoryRank.semantic(1.0,false)<0.92)
    }
}
