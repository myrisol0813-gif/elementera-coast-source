package com.elementeracoast.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** Local reading preferences; names match the Native paper-font wardrobe. */
enum class CoastFontMode(val label: String) {
    CoastClassic("朱雀仿宋"),
    NanoOldSong("纳米老宋"),
    ChillHuoSong("寒蝉活宋"),
    CustomLocal("本机字体");

    companion object {
        fun fromStored(value: String): CoastFontMode = when (value) {
            "Soft" -> NanoOldSong
            "Note" -> ChillHuoSong
            else -> entries.firstOrNull { it.name == value } ?: CoastClassic
        }
    }
}

enum class CoastPaperMode(val label: String) {
    Wave("浅浮雕边"),
    Smooth("圆润无框信纸"),
    Cut("锯齿裁纸边");

    companion object {
        fun fromStored(value: String): CoastPaperMode = entries.firstOrNull { it.name == value } ?: Wave
    }
}

enum class CoastReadingWeight(val label: String, val fontWeight: FontWeight) {
    Normal("正常", FontWeight.Normal),
    Medium("微加粗", FontWeight.Medium),
    Bold("加粗", FontWeight.Bold);

    companion object {
        fun fromStored(value: String): CoastReadingWeight = entries.firstOrNull { it.name == value } ?: Normal
    }
}

/** Shared reading typography for both sides of the chat; the surrounding UI stays sans-serif. */
@Composable
fun coastReadingMessageStyle(lineHeight: TextUnit): TextStyle {
    val appearance = LocalCoastAppearance.current
    val base = MaterialTheme.typography.bodyLarge
    val spacing = if (appearance.fontMode == CoastFontMode.ChillHuoSong) 0.5.sp else 0.02.sp
    return base.copy(
        fontFamily = appearance.readingFontFamily ?: base.fontFamily,
        fontSize = CoastChatTokens.ChatBodySize,
        lineHeight = lineHeight,
        fontWeight = appearance.readingWeight.fontWeight,
        letterSpacing = spacing
    )
}
