package com.elementeracoast.app.ui.theme

import android.app.Activity
import android.content.Context
import android.graphics.Typeface
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import java.io.File

private const val ZHUQUE_FONT_RESOURCE = "zhuque_fangsong_regular"
private const val NANO_OLD_SONG_RESOURCE = "nano_old_song_a_regular"
private const val CHILL_HUO_SONG_RESOURCE = "chill_huo_song_regular"
private val CoastSans = FontFamily.SansSerif
private val CoastTypography = Typography(
    headlineMedium = TextStyle(fontFamily = CoastSans, fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontFamily = CoastSans, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.25).sp),
    titleMedium = TextStyle(fontFamily = CoastSans, fontSize = 17.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.18).sp),
    bodyLarge = TextStyle(fontFamily = CoastSans, fontSize = 16.sp, lineHeight = 25.sp, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontFamily = CoastSans, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontFamily = CoastSans, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontFamily = CoastSans, fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontFamily = CoastSans, fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = CoastSans, fontSize = 11.sp, fontWeight = FontWeight.Medium)
)

private fun bundledFontFamily(context: Context, resourceName: String): FontFamily? {
    val fontId = context.resources.getIdentifier(resourceName, "font", context.packageName)
    return if (fontId == 0) null else FontFamily(Font(fontId))
}

private fun localFontFamily(path: String): FontFamily? = runCatching {
    val file = File(path)
    if (file.isFile && file.length() > 0L) FontFamily(Typeface.createFromFile(file)) else null
}.getOrNull()

private fun zhuqueFallback(context: Context): FontFamily = bundledFontFamily(context, ZHUQUE_FONT_RESOURCE) ?: FontFamily.Serif

private fun readingFontFamily(mode: CoastFontMode, context: Context, localFontPath: String): FontFamily = when (mode) {
    CoastFontMode.CoastClassic -> zhuqueFallback(context)
    // The public source contains no proprietary font assets. Keep the named
    // presets selectable, but use distinct, honest system families when missing.
    CoastFontMode.NanoOldSong -> bundledFontFamily(context, NANO_OLD_SONG_RESOURCE) ?: FontFamily.SansSerif
    CoastFontMode.ChillHuoSong -> bundledFontFamily(context, CHILL_HUO_SONG_RESOURCE) ?: FontFamily.Monospace
    CoastFontMode.CustomLocal -> localFontFamily(localFontPath) ?: zhuqueFallback(context)
}

@Composable
fun CoastTheme(
    preset: CoastThemePreset,
    accentHex: String = "",
    userBubbleHex: String = "",
    fontMode: CoastFontMode = CoastFontMode.CoastClassic,
    paperMode: CoastPaperMode = CoastPaperMode.Wave,
    cloudOutlineEnabled: Boolean = true,
    readingWeight: CoastReadingWeight = CoastReadingWeight.Normal,
    messageSurfaceAlpha: Float = .94f,
    chatBackgroundImagePath: String = "",
    chatBackgroundDimAlpha: Float = .18f,
    localFontPath: String = "",
    content: @Composable () -> Unit
) {
    val basePalette = preset.palette()
    val customAccent = parseCoastHex(accentHex)
    val palette = if (customAccent == null) basePalette else basePalette.copy(primary = customAccent, accent = customAccent)
    val colors = palette.toColorScheme()
    val view = LocalView.current
    val context = LocalContext.current
    val readingFamily = readingFontFamily(fontMode, context, localFontPath)
    if (!view.isInEditMode) {
        SideEffect {
            val activity = view.context as? Activity ?: return@SideEffect
            val window = activity.window
            window.statusBarColor = colors.background.toArgb()
            window.navigationBarColor = colors.background.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = palette.isLight
                isAppearanceLightNavigationBars = palette.isLight
            }
        }
    }

    CompositionLocalProvider(
        LocalCoastAppearance provides CoastAppearance(
            preset = preset,
            palette = palette,
            userBubbleColor = parseCoastHex(userBubbleHex),
            fontMode = fontMode,
            paperMode = paperMode,
            cloudOutlineEnabled = cloudOutlineEnabled,
            readingWeight = readingWeight,
            messageSurfaceAlpha = messageSurfaceAlpha.coerceIn(.55f, 1f),
            chatBackgroundImagePath = chatBackgroundImagePath,
            chatBackgroundDimAlpha = chatBackgroundDimAlpha.coerceIn(0f, .65f),
            readingFontFamily = readingFamily
        )
    ) {
        MaterialTheme(colorScheme = colors, typography = CoastTypography, content = content)
    }
}
