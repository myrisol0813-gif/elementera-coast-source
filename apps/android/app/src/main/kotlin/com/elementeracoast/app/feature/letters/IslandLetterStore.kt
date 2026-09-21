package com.elementeracoast.app.feature.letters

import com.elementeracoast.app.core.local.LocalPersistence

class IslandLetterStore(private val persistence: LocalPersistence) {
    fun read(conversationId: String, modelName: String): String =
        persistence.get(key(conversationId, modelName)).ifBlank { defaultIslandLetter(modelName) }

    fun save(conversationId: String, modelName: String, text: String): String {
        val clean = text.take(MAX_LENGTH)
        persistence.put(key(conversationId, modelName), clean)
        return clean
    }

    fun reset(conversationId: String, modelName: String): String {
        persistence.remove(key(conversationId, modelName))
        return defaultIslandLetter(modelName)
    }

    private fun key(conversationId: String, modelName: String): String =
        "letters.island::$conversationId::$modelName"

    companion object {
        const val MAX_LENGTH = 12_000
    }
}
