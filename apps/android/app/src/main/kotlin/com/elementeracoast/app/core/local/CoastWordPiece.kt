package com.elementeracoast.app.core.local

import java.text.Normalizer
import java.util.Locale

/** BERT uncased WordPiece, matching the pinned BGE Chinese vocabulary. */
internal class CoastWordPiece(lines: List<String>) {
    private val vocab=lines.withIndex().associate{it.value to it.index.toLong()}
    private val unk=vocab.getValue("[UNK]")
    private val cls=vocab.getValue("[CLS]")
    private val sep=vocab.getValue("[SEP]")
    private fun cjk(c:Int)=c in 0x4e00..0x9fff||c in 0x3400..0x4dbf||c in 0x20000..0x2a6df||c in 0x2a700..0x2b73f||c in 0x2b740..0x2b81f||c in 0x2b820..0x2ceaf||c in 0xf900..0xfaff||c in 0x2f800..0x2fa1f
    private fun punct(c:Int):Boolean {
        if(c in 33..47||c in 58..64||c in 91..96||c in 123..126)return true
        return Character.getType(c) in setOf(20,21,22,23,24,29,30)
    }
    fun tokens(text:String):List<Long>{
        val basic=mutableListOf<String>()
        val word=StringBuilder()
        fun flush(){if(word.isNotEmpty()){basic.add(word.toString());word.setLength(0)}}
        val clean=Normalizer.normalize(text.lowercase(Locale.ROOT),Normalizer.Form.NFD)
        clean.codePoints().forEachOrdered{c->
            when{
                c==0||c==0xfffd||Character.getType(c)==6->Unit
                Character.isWhitespace(c)||Character.isSpaceChar(c)->flush()
                Character.getType(c) in setOf(15,16)->Unit
                cjk(c)||punct(c)->{flush();basic.add(String(Character.toChars(c)))}
                else->word.appendCodePoint(c)
            }
        }
        flush()
        val out=mutableListOf<Long>()
        for(token in basic){
            if(token.codePointCount(0,token.length)>100){out.add(unk);continue}
            val cps=token.codePoints().toArray()
            val parts=mutableListOf<Long>()
            var start=0
            while(start<cps.size){
                var end=cps.size
                var id:Long?=null
                while(end>start){
                    val piece=(if(start==0)"" else "##")+String(cps,start,end-start)
                    id=vocab[piece]
                    if(id!=null)break
                    end--
                }
                if(id==null){parts.clear();parts.add(unk);break}
                parts.add(id);start=end
            }
            out.addAll(parts)
        }
        return out
    }
    fun frame(tokens:List<Long>)=(listOf(cls)+tokens.take(510)+sep).toLongArray()
    fun encode(text:String)=frame(tokens(text))
}
