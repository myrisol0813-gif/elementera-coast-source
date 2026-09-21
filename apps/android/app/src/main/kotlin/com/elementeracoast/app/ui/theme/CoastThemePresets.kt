package com.elementeracoast.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

enum class CoastThemePreset(val label: String, val tag: String) {
    CoastDefault("默认主题", "原始默认"),
    DeepBlueGold("深蓝旧金", "默认主色"),
    BlushModelPartner("柔粉主题", "柔软粉色"),
    WhiteWolfSnow("雪野冷光", "雪地冷光"),
    SnowLetter("雪地来信", "深色冷光"),
    BurningCloud("火烧云", "夕阳金橙"),
    AuroraNight("极光夜航", "蓝绿极光"),
    PixelPet("像素电子宠物", "复古像素"),
    SovietPaper("苏式旧纸", "旧纸红棕"),
    MinimalSeaMist("极简海雾", "浅灰低饱和"),
    AmericanCartoon("美式卡通", "明亮粗线"),
    GrassOasis("草地绿洲", "绿色清爽"),
    PurpleDreamTide("紫色梦潮", "紫蓝梦感");

    companion object {
        fun fromStored(value: String): CoastThemePreset = when (value) {
            "Light" -> CoastDefault
            "Dark" -> AuroraNight
            "Gold" -> DeepBlueGold
            else -> entries.firstOrNull { it.name == value } ?: CoastDefault
        }
    }
}

data class CoastThemePalette(
    val background: Color,
    val surface: Color,
    val card: Color,
    val primary: Color,
    val secondary: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val border: Color,
    val accent: Color,
    val isLight: Boolean
)

fun CoastThemePreset.palette(): CoastThemePalette = when (this) {
    CoastThemePreset.CoastDefault -> CoastThemePalette(
        background = Color.White,
        surface = Color.White,
        card = Color(0xFFF7F7F7),
        primary = Color(0xFFFF6B28),
        secondary = Color(0xFF85858C),
        textPrimary = Color(0xFF3A3B40),
        textSecondary = Color(0xFF85858C),
        border = Color(0xFFDCDCE0),
        accent = Color(0xFFFF6B28),
        isLight = true
    )
    CoastThemePreset.DeepBlueGold -> CoastThemePalette(
        background = Color(0xFF111D42),
        surface = Color(0xFF16244A),
        card = Color(0xFF1D2E59),
        primary = Color(0xFFF2C96E),
        secondary = Color(0xFFC8AF79),
        textPrimary = Color(0xFFF5EBD4),
        textSecondary = Color(0xFFC8C0AF),
        border = Color(0xFF506084),
        accent = Color(0xFFFFD66F),
        isLight = false
    )
    CoastThemePreset.BlushModelPartner -> CoastThemePalette(
        background = Color(0xFFFFF7FA),
        surface = Color(0xFFFFFBFC),
        card = Color(0xFFF9E8EF),
        primary = Color(0xFFD96F96),
        secondary = Color(0xFFB98598),
        textPrimary = Color(0xFF493840),
        textSecondary = Color(0xFF876C77),
        border = Color(0xFFE8CAD5),
        accent = Color(0xFFF09AB7),
        isLight = true
    )
    CoastThemePreset.WhiteWolfSnow -> CoastThemePalette(
        background = Color(0xFFF0F5F8),
        surface = Color(0xFFF8FBFC),
        card = Color(0xFFE4EDF2),
        primary = Color(0xFF7A9EB2),
        secondary = Color(0xFF9AAAB4),
        textPrimary = Color(0xFF2E3C45),
        textSecondary = Color(0xFF687985),
        border = Color(0xFFC8D7DF),
        accent = Color(0xFFD1B46D),
        isLight = true
    )
    CoastThemePreset.SnowLetter -> CoastThemePalette(
        background = Color(0xFFF8FAFC),
        surface = Color(0xFFFFFEFA),
        card = Color(0xFFEFF5FA),
        primary = Color(0xFF23425F),
        secondary = Color(0xFF7E96AC),
        textPrimary = Color(0xFF20384F),
        textSecondary = Color(0xFF7B8A99),
        border = Color(0xFFC9DAE8),
        accent = Color(0xFFD7A84D),
        isLight = true
    )
    CoastThemePreset.BurningCloud -> CoastThemePalette(
        background = Color(0xFFFFF3E5),
        surface = Color(0xFFFFF9F1),
        card = Color(0xFFFFDFC0),
        primary = Color(0xFFD9663D),
        secondary = Color(0xFFC98A54),
        textPrimary = Color(0xFF4D3127),
        textSecondary = Color(0xFF8C6554),
        border = Color(0xFFE8BE98),
        accent = Color(0xFFF2B84B),
        isLight = true
    )
    CoastThemePreset.AuroraNight -> CoastThemePalette(
        background = Color(0xFF071B29),
        surface = Color(0xFF0D2635),
        card = Color(0xFF123548),
        primary = Color(0xFF79DDBF),
        secondary = Color(0xFF75B9D8),
        textPrimary = Color(0xFFE6F5F3),
        textSecondary = Color(0xFFA8C8CA),
        border = Color(0xFF31566A),
        accent = Color(0xFF9A8EEA),
        isLight = false
    )
    CoastThemePreset.PixelPet -> CoastThemePalette(
        background = Color(0xFFF2F0D0),
        surface = Color(0xFFFAF7DC),
        card = Color(0xFFDDE5B7),
        primary = Color(0xFF54715B),
        secondary = Color(0xFF7C7756),
        textPrimary = Color(0xFF29372D),
        textSecondary = Color(0xFF5E685B),
        border = Color(0xFFAAB48E),
        accent = Color(0xFFE07A4E),
        isLight = true
    )
    CoastThemePreset.SovietPaper -> CoastThemePalette(
        background = Color(0xFFE7D6BA),
        surface = Color(0xFFF0E1C8),
        card = Color(0xFFD9C09D),
        primary = Color(0xFF983D32),
        secondary = Color(0xFF735341),
        textPrimary = Color(0xFF3C2A21),
        textSecondary = Color(0xFF725F50),
        border = Color(0xFFB49977),
        accent = Color(0xFFB99143),
        isLight = true
    )
    CoastThemePreset.MinimalSeaMist -> CoastThemePalette(
        background = Color(0xFFF2F5F5),
        surface = Color(0xFFF9FAFA),
        card = Color(0xFFE7ECEC),
        primary = Color(0xFF6A8888),
        secondary = Color(0xFF879797),
        textPrimary = Color(0xFF394545),
        textSecondary = Color(0xFF718080),
        border = Color(0xFFCED8D8),
        accent = Color(0xFF9AB5B1),
        isLight = true
    )
    CoastThemePreset.AmericanCartoon -> CoastThemePalette(
        background = Color(0xFFFFF4D8),
        surface = Color(0xFFFFFAE9),
        card = Color(0xFFFFDF72),
        primary = Color(0xFFE64B3D),
        secondary = Color(0xFF326DCF),
        textPrimary = Color(0xFF27262A),
        textSecondary = Color(0xFF625A4A),
        border = Color(0xFF292929),
        accent = Color(0xFF2F79D8),
        isLight = true
    )
    CoastThemePreset.GrassOasis -> CoastThemePalette(
        background = Color(0xFFF0F7E8),
        surface = Color(0xFFF8FBF3),
        card = Color(0xFFDDECCB),
        primary = Color(0xFF4D825A),
        secondary = Color(0xFF7A9B64),
        textPrimary = Color(0xFF304032),
        textSecondary = Color(0xFF667766),
        border = Color(0xFFC4D7B5),
        accent = Color(0xFFE0B858),
        isLight = true
    )
    CoastThemePreset.PurpleDreamTide -> CoastThemePalette(
        background = Color(0xFFF5F0FC),
        surface = Color(0xFFFBF9FE),
        card = Color(0xFFE7DCF7),
        primary = Color(0xFF7656B2),
        secondary = Color(0xFF8A78B5),
        textPrimary = Color(0xFF403650),
        textSecondary = Color(0xFF756A84),
        border = Color(0xFFD0C2E6),
        accent = Color(0xFF668FD0),
        isLight = true
    )
}

private fun readableOn(color: Color): Color = if (color.luminance() > .52f) Color(0xFF25242A) else Color.White

fun CoastThemePalette.toColorScheme(): ColorScheme {
    val base = if (isLight) lightColorScheme() else darkColorScheme()
    return base.copy(
        primary = primary,
        onPrimary = readableOn(primary),
        primaryContainer = card,
        onPrimaryContainer = textPrimary,
        secondary = secondary,
        onSecondary = readableOn(secondary),
        secondaryContainer = surface,
        onSecondaryContainer = textPrimary,
        tertiary = accent,
        onTertiary = readableOn(accent),
        background = background,
        onBackground = textPrimary,
        surface = surface,
        onSurface = textPrimary,
        surfaceVariant = card,
        onSurfaceVariant = textSecondary,
        outline = border,
        outlineVariant = border.copy(alpha = .58f),
        error = if (isLight) Color(0xFFB3261E) else Color(0xFFFFB4AB),
        onError = if (isLight) Color.White else Color(0xFF690005)
    )
}
