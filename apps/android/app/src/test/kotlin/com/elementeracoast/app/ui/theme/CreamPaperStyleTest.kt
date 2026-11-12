package com.elementeracoast.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CreamPaperStyleTest {
    private val palette = CoastThemePreset.CreamPaper.palette()
    private val appearance = CoastAppearance(preset = CoastThemePreset.CreamPaper, palette = palette)

    @Test fun everyThemeRoundTripsThroughExistingStoredNames() {
        CoastThemePreset.entries.forEach { preset ->
            assertEquals(preset, CoastThemePreset.fromStored(preset.name))
        }
        assertEquals(CoastThemePreset.CoastDefault, CoastThemePreset.fromStored(""))
        assertEquals(CoastThemePreset.CoastDefault, CoastThemePreset.fromStored("future-theme"))
    }

    @Test fun textAndControlsRemainReadableOnCreamAndPink() {
        assertTrue(palette.isLight)
        listOf(palette.background, palette.surface, palette.card).forEach { surface ->
            assertTrue("Body text on $surface", contrast(palette.textPrimary, surface) >= 4.5f)
            assertTrue("Secondary text on $surface", contrast(palette.textSecondary, surface) >= 4.5f)
            assertTrue("Card outlines on $surface", contrast(palette.border, surface) >= 3f)
        }
        val colors = palette.toColorScheme()
        assertTrue(contrast(colors.onPrimary, colors.primary) >= 4.5f)
        assertTrue(contrast(colors.onTertiary, colors.tertiary) >= 4.5f)
    }

    @Test fun messagePaperHonorsOpacityAndCustomBubbleAcrossSavedPaperModes() {
        val custom = Color(0xCCBED4DA)
        CoastPaperMode.entries.forEach { mode ->
            val configured = appearance.copy(paperMode = mode, userBubbleColor = custom, messageSurfaceAlpha = .6f)
            val actual = creamPaperFill(SnowLetterSurfaceRole.UserBubble, configured, Color.Red)
            assertEquals(custom.copy(alpha = custom.alpha * .6f), actual)
            assertEquals(palette.surface.copy(alpha = .6f), creamPaperFill(SnowLetterSurfaceRole.AssistantBubble, configured, Color.Transparent))
            assertEquals(mode, configured.paperMode)
        }
        assertNotEquals(
            creamPaperFill(SnowLetterSurfaceRole.UserBubble, appearance, Color.Transparent),
            creamPaperFill(SnowLetterSurfaceRole.AssistantBubble, appearance, Color.Transparent)
        )
    }

    @Test fun importedOutOfRangeOpacityIsClampedButControlColorsAreUntouched() {
        assertEquals(palette.card.copy(alpha = .55f), creamPaperFill(
            SnowLetterSurfaceRole.UserBubble, appearance.copy(messageSurfaceAlpha = 0f), Color.Transparent
        ))
        assertEquals(palette.surface, creamPaperFill(
            SnowLetterSurfaceRole.AssistantBubble, appearance.copy(messageSurfaceAlpha = 2f), Color.Transparent
        ))
        SnowLetterSurfaceRole.entries.filterNot {
            it == SnowLetterSurfaceRole.UserBubble || it == SnowLetterSurfaceRole.AssistantBubble
        }.forEach { role ->
            val disabledOrSemanticColor = Color(0x55A42424)
            assertEquals(disabledOrSemanticColor, creamPaperFill(role, appearance, disabledOrSemanticColor))
        }
    }

    private fun contrast(a: Color, b: Color): Float =
        (maxOf(a.luminance(), b.luminance()) + .05f) /
            (minOf(a.luminance(), b.luminance()) + .05f)
}
