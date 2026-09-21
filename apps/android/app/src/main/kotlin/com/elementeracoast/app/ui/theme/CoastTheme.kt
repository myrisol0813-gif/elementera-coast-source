package com.elementeracoast.app.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

private val CoastSans = FontFamily.SansSerif
private val CoastTypography = Typography(
    headlineMedium = TextStyle(fontFamily = CoastSans, fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontFamily = CoastSans, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.25).sp),
    titleMedium = TextStyle(fontFamily = CoastSans, fontSize = 17.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.18).sp),
    bodyLarge = TextStyle(fontFamily = CoastSans, fontSize = 16.sp, lineHeight = 25.sp, fontWeight = FontWeight.Medium),
    bodyMedium = TextStyle(fontFamily = CoastSans, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium),
    bodySmall = TextStyle(fontFamily = CoastSans, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelLarge = TextStyle(fontFamily = CoastSans, fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontFamily = CoastSans, fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = CoastSans, fontSize = 11.sp, fontWeight = FontWeight.Medium)
)

@Composable
fun CoastTheme(
    preset: CoastThemePreset,
    accentHex: String = "",
    userBubbleHex: String = "",
    content: @Composable () -> Unit
) {
    val basePalette = preset.palette()
    val customAccent = parseCoastHex(accentHex)
    val palette = if (customAccent == null) basePalette else basePalette.copy(primary = customAccent, accent = customAccent)
    val colors = palette.toColorScheme()
    val view = LocalView.current
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
            userBubbleColor = parseCoastHex(userBubbleHex)
        )
    ) {
        MaterialTheme(colorScheme = colors, typography = CoastTypography, content = content)
    }
}
