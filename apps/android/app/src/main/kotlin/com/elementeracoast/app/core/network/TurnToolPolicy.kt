package com.elementeracoast.app.core.network

/** Bounded per-turn execution; the final continuation must not start any new tools. */
internal object TurnToolPolicy {
    const val MAX_CALLS = 24
    const val MAX_ROUNDS = 24
    const val LIMIT_RECEIPT = "{\"ok\":false,\"code\":\"tool_limit\",\"message\":\"本轮工具额度已用完，此项未执行。请根据已有结果完成回复。\"}"
    const val LIMIT_NOTICE = "\n\n本轮工具额度已用完，额外调用未执行。已完成的操作保留。"
    fun finalOnly(round: Int, calls: Int, limit: Int = MAX_CALLS): Boolean =
        round >= MAX_ROUNDS || calls >= limit
    fun canExecute(calls: Int, limit: Int = MAX_CALLS): Boolean = calls < limit
}
