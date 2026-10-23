package com.elementeracoast.app.ui.theme

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SnowLetterPaperModeTest {
    @Test
    fun embossedModeKeepsTheExistingRoundedMessagePaperOnly() {
        assertTrue(SnowLetterSurfaceRole.AssistantBubble.usesEmbossedPaper(CoastPaperMode.Wave))
        assertTrue(SnowLetterSurfaceRole.UserBubble.usesEmbossedPaper(CoastPaperMode.Wave))
        assertFalse(SnowLetterSurfaceRole.StatusCard.usesEmbossedPaper(CoastPaperMode.Wave))
        assertFalse(SnowLetterSurfaceRole.DogtalkCard.usesEmbossedPaper(CoastPaperMode.Wave))
        assertFalse(SnowLetterSurfaceRole.ComposerField.usesEmbossedPaper(CoastPaperMode.Wave))
    }

    @Test
    fun cutModeIsIndependentAndAvailableToEverySnowLetterSurface() {
        SnowLetterSurfaceRole.entries.forEach { role ->
            assertTrue(role.usesCutPaper(CoastPaperMode.Cut))
            assertFalse(role.usesEmbossedPaper(CoastPaperMode.Cut))
        }
    }

    @Test
    fun smoothModeUsesOnlyFallbackShapes() {
        SnowLetterSurfaceRole.entries.forEach { role ->
            assertFalse(role.usesEmbossedPaper(CoastPaperMode.Smooth))
            assertFalse(role.usesCutPaper(CoastPaperMode.Smooth))
        }
    }
}
