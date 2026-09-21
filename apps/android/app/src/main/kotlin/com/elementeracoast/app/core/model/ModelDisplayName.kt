package com.elementeracoast.app.core.model

/**
 * Human-facing model label only. The canonical model id is never changed by this formatter.
 */
fun modelDisplayName(modelId: String): String {
    val canonical = modelId.trim()
    if (canonical.isBlank()) return ""
    val leaf = canonical.substringAfterLast('/').ifBlank { canonical }
    return leaf.replaceFirst(Regex("^gpt-", RegexOption.IGNORE_CASE), "")
}
