package com.elementeracoast.app.core.network

/** Bounded per-turn execution; the final continuation must not start any new tools. */
internal object TurnToolPolicy {
    const val DEFAULT_CALLS = 24
    // Resource/protocol bound, not a product default. Exposed in Basic Settings.
    const val MAX_CALLS = 128
    const val MAX_ROUNDS = MAX_CALLS
    const val STORE_KEY = "wolf.toolCallLimit"
    fun normalize(value:Int?)=(value?:DEFAULT_CALLS).coerceIn(1,MAX_CALLS)
    fun stored(store:com.elementeracoast.app.core.local.LocalPersistence)=normalize(store.get(STORE_KEY).toIntOrNull())
    const val LIMIT_RECEIPT = "{\"ok\":false,\"code\":\"tool_limit\",\"message\":\"本轮工具额度已用完，此项未执行。请根据已有结果完成回复。\"}"
    const val LIMIT_NOTICE = "\n\n本轮工具额度已用完，额外调用未执行。已完成的操作保留。"
    fun finalOnly(round: Int, calls: Int, limit: Int = DEFAULT_CALLS): Boolean =
        round >= limit || calls >= limit
    fun canExecute(calls: Int, limit: Int = DEFAULT_CALLS): Boolean = calls < limit
}
