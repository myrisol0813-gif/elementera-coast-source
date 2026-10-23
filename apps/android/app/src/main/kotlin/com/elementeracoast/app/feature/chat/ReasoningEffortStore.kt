package com.elementeracoast.app.feature.chat

import android.content.Context

/** Local per-model choice; does not persist API credentials or send data to another provider. */
class ReasoningEffortStore private constructor(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("coast_reasoning_effort", Context.MODE_PRIVATE)

    fun get(modelId: String, offered: List<String>): String? =
        prefs.getString(modelId, null)?.takeIf { it in offered }

    fun set(modelId: String, effort: String?, offered: List<String>) {
        require(effort == null || effort in offered)
        prefs.edit().apply {
            if (effort == null) remove(modelId) else putString(modelId, effort)
        }.apply()
    }

    companion object {
        fun production(context: Context) = ReasoningEffortStore(context)
    }
}
