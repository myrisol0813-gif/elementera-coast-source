package com.elementeracoast.app.core.local

/** Preserve exact lexical evidence; provisional semantic thresholds calibrated on reference fixtures. */
internal object LocalHybridMemoryRank {
    fun semantic(cosine:Double?,explicit:Boolean):Double {
        if(cosine==null||!cosine.isFinite())return 0.0
        val minimum=if(explicit)0.40 else 0.48
        if(cosine<minimum)return 0.0
        return (if(explicit)0.58+(cosine-minimum)*0.60 else 0.74+(cosine-minimum)*0.38).coerceAtMost(0.91)
    }
    fun reason(lexical:Double,semantic:Double)=when{
        lexical>0&&semantic>0->"本机关键词与语义混合命中"
        semantic>0->"本机语义命中"
        else->"本机关键词命中"
    }
}
