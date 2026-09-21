package com.elementeracoast.app.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CoastAppearanceTest {
    @Test
    fun sixDigitHexUsesStandardArgbPacking() {
        assertEquals(Color(0xFFFF6A21), parseCoastHex("#ff6a21"))
        assertEquals(Color(0xFFF28B2E), parseCoastHex("#f28b2e"))
        assertEquals(Color(0xFF3B82F6), parseCoastHex("#3b82f6"))
        assertEquals(Color(0xFFEC4899), parseCoastHex("#ec4899"))
    }

    @Test
    fun invalidHexIsIgnored() {
        assertNull(parseCoastHex(""))
        assertNull(parseCoastHex("#123"))
        assertNull(parseCoastHex("#zzzzzz"))
    }
}
