package com.elementeracoast.app.feature.daily

/**
 * Reflow a chapter into small pages without deleting, normalizing or renumbering
 * any original UTF-16 character. A highlight always points at the original text.
 */
internal data class TidalSegment(
    val paragraphIndex: Int, val start: Int, val end: Int, val text: String
)
internal fun paginateTidalChapter(paragraphs: List<Pair<Int, String>>, budget: Int): List<List<TidalSegment>> {
    require(budget in 180..1200)
    val pages = mutableListOf<List<TidalSegment>>()
    val current = mutableListOf<TidalSegment>()
    var used = 0
    fun flush() {
        if (current.isNotEmpty()) pages.add(current.toList())
        current.clear()
        used = 0
    }
    paragraphs.forEach { (paragraphIndex, text) ->
        var offset = 0
        while (offset < text.length) {
            val room = budget - used
            if (room <= 0) { flush(); continue }
            var end = (offset + room).coerceAtMost(text.length)
            if (end < text.length && end - offset > 100) {
                val punctuation = listOf('。', '？', '！', '，', ' ').maxOf { symbol ->
                    text.lastIndexOf(symbol, end - 1)
                }
                if (punctuation > offset + (end - offset) * 2 / 3) end = punctuation + 1
            }
            val slice = text.substring(offset, end)
            current.add(TidalSegment(paragraphIndex, offset, end, slice))
            used += slice.length
            offset = end
            if (used >= budget) flush()
        }
        if (used + 2 > budget) flush() else used += 2
    }
    flush()
    return pages.ifEmpty { listOf(emptyList()) }
}
internal fun tidalPageFor(pages: List<List<TidalSegment>>, paragraph: Int, offset: Int = 0): Int =
    pages.indexOfFirst { page -> page.any { it.paragraphIndex == paragraph && it.start <= offset && it.end > offset } }
        .coerceAtLeast(0)
