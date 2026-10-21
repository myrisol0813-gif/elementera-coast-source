package com.elementeracoast.app.ui.theme

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight

enum class CoastReadingWeight(val fontWeight: FontWeight) {
    Normal(FontWeight.Normal), Medium(FontWeight.Medium), Bold(FontWeight.Bold)
}

data class CoastAppearance(
    val preset: CoastThemePreset = CoastThemePreset.CoastDefault,
    val palette: CoastThemePalette = CoastThemePreset.CoastDefault.palette(),
    val userBubbleColor: Color? = null,
    val readingFontFamily: FontFamily? = null,
    val readingWeight: CoastReadingWeight = CoastReadingWeight.Normal
)

val LocalCoastAppearance = staticCompositionLocalOf { CoastAppearance() }

fun parseCoastHex(value: String): Color? {
    val clean = value.trim().removePrefix("#")
    if (!Regex("^[0-9a-fA-F]{6}$").matches(clean)) return null
    return runCatching { Color(0xFF000000L or clean.toLong(16)) }.getOrNull()
}
