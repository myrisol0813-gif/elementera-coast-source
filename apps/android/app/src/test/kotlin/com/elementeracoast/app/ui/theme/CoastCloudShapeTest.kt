package com.elementeracoast.app.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CoastCloudShapeTest {
    @Test fun cloudModeIsChosenByPaperModeNotTheme() {
        assertEquals(CoastPaperMode.Cloud, CoastPaperMode.fromStored("Cloud"))
        assertEquals(CoastPaperMode.Wave, CoastPaperMode.fromStored("unknown"))
        for (role in SnowLetterSurfaceRole.entries) {
            val isSmallRoundControl =
                role == SnowLetterSurfaceRole.ActionButton || role == SnowLetterSurfaceRole.ComposerButton
            assertEquals(role.name, !isSmallRoundControl, role.usesCloudPaper(CoastPaperMode.Cloud))
            for (other in listOf(CoastPaperMode.Wave, CoastPaperMode.Smooth, CoastPaperMode.Cut)) {
                assertFalse("$role/$other", role.usesCloudPaper(other))
            }
        }
    }

    @Test fun adaptiveCloudSegmentsAreBoundedForLongAndTinySurfaces() {
        assertEquals(1, coastCloudLobeCount(-5f, 80f, 5))
        assertEquals(1, coastCloudLobeCount(0f, 80f, 5))
        assertEquals(1, coastCloudLobeCount(40f, 80f, 5))
        assertEquals(3, coastCloudLobeCount(230f, 80f, 5))
        assertEquals(5, coastCloudLobeCount(1200f, 80f, 5))
        assertEquals(9, coastCloudLobeCount(2400f, 110f, 9))
        assertEquals(1, coastCloudLobeCount(100f, 0f, 5))
        assertEquals(1, coastCloudLobeCount(100f, 100f, 0))
    }
}
