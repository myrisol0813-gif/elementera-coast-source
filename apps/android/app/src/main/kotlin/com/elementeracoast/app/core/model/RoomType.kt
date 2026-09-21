package com.elementeracoast.app.core.model

/**
 * Native mirror of Web/PWA app-57 `conversation.room_type`.
 *
 * The Android shell deliberately keeps one shared ChatWindow for all three values.
 */
enum class RoomType(
    val wireValue: String,
    val drawerLabel: String,
    val titlePrefix: String
) {
    Main("main", "主聊天", ""),
    Radio("radio", "共通聊天室", "【电波】"),
    Lighthouse("lighthouse", "MCP 对话区", "【灯塔】");

    companion object {
        fun fromWire(value: String?): RoomType =
            entries.firstOrNull { it.wireValue == value } ?: Main
    }
}

fun roomConversationTitle(roomType: RoomType, index: Int): String =
    roomConversationTitle(roomType, "新聊天 ${index.coerceAtLeast(1)}")

fun roomConversationTitle(roomType: RoomType, rawTitle: String): String {
    val clean = RoomType.entries.fold(rawTitle.trim()) { title, type ->
        title.removePrefix(type.titlePrefix).trim()
    }
    if (clean.isBlank()) return ""
    return "${roomType.titlePrefix}$clean"
}
