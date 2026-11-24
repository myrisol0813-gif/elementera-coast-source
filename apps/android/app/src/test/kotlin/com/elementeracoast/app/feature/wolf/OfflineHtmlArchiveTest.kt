package com.elementeracoast.app.feature.wolf

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream

class OfflineHtmlArchiveTest {
    @Test fun archivesVariantsMediaAndWarnings() {
        val snapshot=Json.parseToJsonElement("""{"chat":{"conversations":[{"conversation":{"id":"c","title":"<script>x</script>"},"history":{"turns":[{"user":{"variants":[{"content":"<script>x</script>","attachments":[{"id":"a"}]},{"content":"second branch"}]},"assistant":{"variantsByUserVariant":{"0":[{"content":"reply"}],"1":[{"content":"other reply"}]}}}]}}]},"attachments":{"payloads":[{"id":"a","conversation_id":"c","name":"../../a.png","mime":"image/png","size":3,"data_base64":"AQID"},{"id":"bad","size":9,"data_base64":"AQID"}]},"voice":{"payloads":[{"id":"v","chunks":["BAU="]}]},"excluded_modules":["credentials"]}""")
        val output=ByteArrayOutputStream()
        val warnings=OfflineHtmlArchive.write(snapshot,output)
        assertEquals(1,warnings.size)
        val files=mutableMapOf<String,ByteArray>()
        ZipInputStream(ByteArrayInputStream(output.toByteArray())).use { zip ->
            while(true) { val entry=zip.nextEntry ?: break;files[entry.name]=zip.readBytes();zip.closeEntry() }
        }
        assertArrayEquals(byteArrayOf(1,2,3),files.getValue("media/1.png"))
        assertArrayEquals(byteArrayOf(4,5),files.getValue("media/2.mp3"))
        val html=files.getValue("chats/1.html").decodeToString()
        assertTrue(html.contains("second branch") && html.contains("other reply"))
        assertTrue(html.contains("&lt;script&gt;") && !html.contains("<script>"))
        assertTrue(html.contains("../media/1.png"))
        assertTrue(files.getValue("manifest.json").decodeToString().contains("\"restore_supported\":false"))
    }
}
