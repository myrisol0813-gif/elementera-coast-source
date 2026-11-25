package com.elementeracoast.app.core.local

import android.content.Context
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.LongBuffer
import kotlin.math.sqrt

/** Bundled, CPU-only encoder. No provider credentials, network, or chat model dependency. */
internal class CoastEmbedding(context:Context):AutoCloseable {
    private val assets=context.applicationContext.assets
    private val tokenizer=assets.open("coast-embedding/vocab.txt").bufferedReader(Charsets.UTF_8).use{CoastWordPiece(it.readLines())}
    private val env=OrtEnvironment.getEnvironment()
    private val session=OrtSession.SessionOptions().use{options->
        options.setIntraOpNumThreads(2)
        options.setInterOpNumThreads(1)
        env.createSession(assets.open("coast-embedding/model.onnx").use{it.readBytes()},options)
    }
    private fun infer(ids:LongArray):FloatArray {
        val shape=longArrayOf(1,ids.size.toLong())
        fun tensor(values:LongArray)=OnnxTensor.createTensor(env,LongBuffer.wrap(values),shape)
        tensor(ids).use{input->
            tensor(LongArray(ids.size){1L}).use{mask->
                tensor(LongArray(ids.size)).use{types->
                    session.run(mapOf("input_ids" to input,"attention_mask" to mask,"token_type_ids" to types)).use{result->
                        val raw=result[0].value as Array<*>
                        val first=(raw[0] as Array<*>)[0] as FloatArray
                        require(first.size==512&&first.all{it.isFinite()})
                        val norm=sqrt(first.sumOf{it.toDouble()*it}).toFloat()
                        require(norm>0&&norm.isFinite())
                        return FloatArray(512){first[it]/norm}
                    }
                }
            }
        }
    }
    fun query(text:String)=infer(tokenizer.encode("为这个句子生成表示以用于检索相关文章："+text))
    fun documents(text:String):List<FloatArray> = tokenizer.tokens(text).chunked(510).map{infer(tokenizer.frame(it))}
    override fun close(){session.close()}
}
