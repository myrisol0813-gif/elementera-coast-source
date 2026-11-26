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

    @Test fun verifiedV2ReadingCopyContainsBooksNotesAndOriginals() {
        val root=java.nio.file.Files.createTempDirectory("reading-copy").toFile()
        try {
            val file=java.io.File(root,"v2.zip")
            val objects=linkedMapOf<String,com.elementeracoast.app.core.local.ArchiveV2Object>()
            val records=mutableListOf<com.elementeracoast.app.core.local.ArchiveV2Record>()
            com.elementeracoast.app.core.local.ArchiveV2ZipWriter(file.outputStream()).use { writer->
                fun objectBytes(bytes:ByteArray):String {
                    val hashes=listOf(com.elementeracoast.app.core.local.ArchiveV2Chunks.digest(bytes))
                    val d=com.elementeracoast.app.core.local.ArchiveV2Object(bytes.size.toLong(),hashes,com.elementeracoast.app.core.local.ArchiveV2Chunks.fingerprint(bytes.size.toLong(),hashes))
                    if(d.objectSha256 !in objects){writer.objectEntry(d,ByteArrayInputStream(bytes));objects[d.objectSha256]=d}
                    return d.objectSha256
                }
                fun record(module:String,id:String,kind:String,data:String,media:List<String> = emptyList(),deps:List<String> = emptyList()){
                    val hash=objectBytes("""{"kind":"$kind","data":$data}""".encodeToByteArray())
                    records.add(com.elementeracoast.app.core.local.ArchiveV2Record(module,id,hash,media,deps))
                }
                record("library","b","library_books","""{"id":"b","title":"Fixture <script>","format":"txt"}""")
                record("library","c","library_chapters","""{"book_id":"b","chapter_index":0,"title":"Chapter","body":"first\n\nsecond"}""",deps=listOf("library/b"))
                record("library","n","library_notes","""{"book_id":"b","kind":"annotation","author":"assistant","chapter_index":0,"paragraph_index":1,"quote":"second","body":"note","created_at":10}""",deps=listOf("library/b"))
                val image=objectBytes(byteArrayOf(1,2,3))
                record("library","cover","library_covers","""{"book_id":"b","mime":"image/png"}""",listOf(image),listOf("library/b"))
                record("voice","v","voice","""{"id":"v","mime":"audio/mpeg"}""",listOf(objectBytes(byteArrayOf(4,5))))
                record("chat","chat","chat","""{"conversation":{"id":"chat","title":"group"},"history":{"turns":[{"user":{"variants":[{"id":"u","content":"hello"}]},"assistant":{"variantsByUserVariant":{"0":[{"id":"old","content":"old"},{"id":"a0","content":"first","reply_sequence":{"id":"seq","index":0}},{"id":"a1","content":"second","reply_sequence":{"id":"seq","index":1},"desk_slip":{"reply_sequence_previous":[{"message_id":"a0","content":"first"}]}}]}}}]}}""")
                val coverage=com.elementeracoast.app.core.local.ArchiveV2Manifests.modules.map{m->com.elementeracoast.app.core.local.ArchiveV2Coverage(m,if(records.any{it.module==m})"partial" else "unavailable",records.count{it.module==m})}
                writer.finish(com.elementeracoast.app.core.local.ArchiveV2Manifest("elementera-coast-archive",2,"local","com.elementeracoast.source","2026-01-01T00:00:00Z",coverage,records,objects.values.toList()))
            }
            val out=ByteArrayOutputStream()
            assertTrue(OfflineV2HtmlArchive.write(file,out).isEmpty())
            val entries=mutableMapOf<String,ByteArray>()
            ZipInputStream(ByteArrayInputStream(out.toByteArray())).use{zip->while(true){val e=zip.nextEntry?:break;entries[e.name]=zip.readBytes()}}
            val book=entries.getValue("records/1.html").decodeToString()
            val group=entries.filterKeys{it.startsWith("records/")&&it.endsWith(".html")}.values.map{it.decodeToString()}.single{it.contains("连续回复 2")}
            assertTrue(group.contains("版本 2 · 连续回复 1 · 组 seq")&&group.contains("版本 2 · 连续回复 2 · 组 seq")&&group.contains("reply_sequence_previous"))
            assertTrue(book.contains("2.html#p-1")&&book.contains("note")&&book.contains("&lt;script&gt;"))
            assertTrue(entries.getValue("records/2.html").decodeToString().contains("id=\"p-1\""))
            assertArrayEquals(byteArrayOf(1,2,3),entries.getValue("media/1.png"))
            assertArrayEquals(byteArrayOf(4,5),entries.getValue("media/2.mp3"))
            assertTrue(entries.getValue("manifest.json").decodeToString().contains("\"restore_supported\":false"))
        }finally{root.deleteRecursively()}
    }

}
