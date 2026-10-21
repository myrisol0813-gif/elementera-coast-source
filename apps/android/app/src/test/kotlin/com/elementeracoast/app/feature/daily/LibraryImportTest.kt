package com.elementeracoast.app.feature.daily

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class LibraryImportTest {
    @Test fun multipleSpineRootsRemainReadableWithoutStrictXmlParsing() {
        val malformedXhtml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE html>
            <html><head><title>Only metadata</title><style>h1 { color: red }</style></head>
            <body><p>第一段。</p><p>第二段。</p></body></html>
            <p>第三段：这一段在 html 根元素之外。</p>
            <script>alert("not book text")</script>
        """.trimIndent()
        val cleaned = LibraryImport.cleanedSpineMarkup(malformedXhtml)
        assertTrue(cleaned.contains("第一段。"))
        assertTrue(cleaned.contains("第二段。"))
        assertTrue(cleaned.contains("第三段"))
        assertFalse(cleaned.contains("DOCTYPE"))
        assertFalse(cleaned.contains("Only metadata"))
        assertFalse(cleaned.contains("alert"))
        assertFalse(cleaned.contains("color: red"))
    }

    @Test fun malformedXhtmlNeverEnablesEntityDeclarations() {
        assertThrows(IllegalArgumentException::class.java) {
            LibraryImport.cleanedSpineMarkup(
                "<!DOCTYPE html [<!ENTITY xx SYSTEM \"file:///local/private\">]><p>&xx;</p>"
            )
        }
    }

    @Test fun externalDtdDeclarationIsRemovedBeforeOfflineHtmlTextConversion() {
        val cleaned = LibraryImport.cleanedSpineMarkup(
            "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\"><p>正文。</p>"
        )
        assertFalse(cleaned.contains("DOCTYPE"))
        assertTrue(cleaned.contains("正文。"))
    }
}
