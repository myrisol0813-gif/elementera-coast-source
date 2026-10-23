package com.elementeracoast.app.ui.theme

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SnowLetterSkinsTest {
    @Test fun cloudAvailableOnPaperButNotSmallRoundIconButtons() {
        for (role in SnowLetterSurfaceRole.entries) {
            val smallButton = role == SnowLetterSurfaceRole.ActionButton ||
                role == SnowLetterSurfaceRole.ComposerButton
            if (smallButton) assertFalse(role.usesCloudPaper(CoastPaperMode.Cloud))
            else assertTrue(role.usesCloudPaper(CoastPaperMode.Cloud))
            for (mode in listOf(CoastPaperMode.Wave, CoastPaperMode.Smooth, CoastPaperMode.Cut)) {
                assertFalse(role.usesCloudPaper(mode))
            }
        }
    }

    @Test fun cloudDoesNotInterfereWithEstablishedPaperModes() {
        assertTrue(SnowLetterSurfaceRole.AssistantBubble.usesEmbossedPaper(CoastPaperMode.Wave))
        assertTrue(SnowLetterSurfaceRole.UserBubble.usesCutPaper(CoastPaperMode.Cut))
        assertFalse(SnowLetterSurfaceRole.UserBubble.usesCutPaper(CoastPaperMode.Cloud))
        assertFalse(SnowLetterSurfaceRole.AssistantBubble.usesEmbossedPaper(CoastPaperMode.Cloud))
    }
}
