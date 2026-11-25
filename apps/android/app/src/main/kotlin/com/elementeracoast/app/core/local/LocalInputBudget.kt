package com.elementeracoast.app.core.local

import kotlinx.serialization.json.*

/** A reported provider window is not a tokenizer result. Keep output and tools outside the comfort budget. */
internal data class LocalInputBudget(val comfort:Int,val materialLimit:Int?,val wireLimit:Int?,val note:String,val vision:Boolean?) {
    companion object {
        const val AUTO_FALLBACK=18000
        fun resolve(requested:Int,output:Int,tools:Boolean,entry:JsonObject?):LocalInputBudget {
            val top=entry?.get("top_provider") as? JsonObject
            fun positive(v:JsonElement?)=(v as? JsonPrimitive)?.intOrNull?.takeIf{it>0}
            val window=listOfNotNull(positive(entry?.get("context_length")),positive(top?.get("context_length"))).minOrNull()
            val modalities=((entry?.get("architecture") as? JsonObject)?.get("input_modalities")?:entry?.get("input_modalities")) as? JsonArray
            val vision=modalities?.mapNotNull{(it as? JsonPrimitive)?.contentOrNull}?.takeIf{it.isNotEmpty()}?.contains("image")
            val auto=requested==0
            val desired=if(auto)AUTO_FALLBACK else requested.coerceAtLeast(1800)
            if(window==null)return LocalInputBudget(desired,null,null,
                (if(auto)"自动预算 · 供应商未报告窗口容量，采用 18000 token 舒服区间" else "手动预算 · 供应商未报告窗口容量")+"；实际仍由供应商限制。",vision)
            val outputReserve=output.coerceIn(64,65536)
            val wire=window.toLong()-outputReserve-256
            val material=wire-(if(tools)6144 else 0)
            require(material>=1800){"模型目录报告窗口 "+window+" tokens；为输出及工具预留后不足1800，请降低最大输出或关闭不需要的工具。"}
            val max=material.toInt()
            val comfort=if(auto)max else minOf(desired,max)
            return LocalInputBudget(comfort,max,wire.toInt(),
                (if(auto)"自动预算" else "手动预算")+" · 目录窗口 "+window+" tokens · 输出预留 "+outputReserve+
                (if(tools)" · 工具预留 6144" else "")+" · 估算输入上限 "+max+"；实际以供应商为准。",vision)
        }
    }
}
