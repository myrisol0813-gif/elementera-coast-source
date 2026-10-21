package com.elementeracoast.app.feature.daily

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.w3c.dom.Document
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory

/** Text-only EPUB/TXT import; all text is uploaded to canonical Coast, never a local book database. */
internal object LibraryImport {
    private const val FILE_LIMIT = 40 * 1024 * 1024
    private const val TEXT_LIMIT = 12000000
    private const val CHAPTER_LIMIT = 2048
    private const val CHAPTER_CHARS = 32000
    private const val PARAGRAPH_CHARS = 4000

    suspend fun parse(context: Context, uri: Uri): JsonObject = withContext(Dispatchers.IO) {
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: uri.lastPathSegment.orEmpty()
        val ext = name.substringAfterLast('.', "").lowercase()
        require(ext in listOf("txt", "epub")) { "潮中书房目前只支持 TXT 和 EPUB。" }
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readNBytes(FILE_LIMIT + 1) }
            ?: throw IllegalArgumentException("无法读取选中的书籍文件。")
        require(bytes.size <= FILE_LIMIT) { "源文件超过 40 MB，不会截断导入。" }
        val sections = if (ext == "txt") {
            listOf("正文" to bytes.toString(Charsets.UTF_8).removePrefix("\uFEFF"))
        } else epubChapters(bytes)
        val chapters = chapterize(sections.map { (title, body) -> title to readableBody(body) })
        buildJsonObject {
            put("title", name.substringBeforeLast('.').take(160))
            put("format", ext)
            put("chapters", buildJsonArray {
                for ((title, body) in chapters) add(buildJsonObject {
                    put("title", title); put("body", body)
                })
            })
        }
    }

    private fun readableBody(body: String): String {
        // TXT exports sometimes contain serialized HTML paragraphs.
        val paragraphTags = Regex("""(?i)<\s*/?\s*(?:p|br|div|blockquote)\b""").findAll(body).count()
        if (paragraphTags < 2) return body
        val text = android.text.Html.fromHtml(body, android.text.Html.FROM_HTML_MODE_LEGACY).toString()
        return text.replace(Regex("""\n{3,}"""), "\n\n").trim()
    }

    // Spine chapters can contain HTML fragments that browsers tolerate but strict
    // XML DocumentBuilder rejects ("Only one root element allowed", unknown entities).
    // Keep container.xml and OPF strict; read spine content as offline text-only HTML.
    internal fun cleanedSpineMarkup(markup: String): String {
        val html = markup.removePrefix("\uFEFF")
        // A DOCTYPE in the chapter is harmless once removed before TagSoup;
        // never allow entity declarations or DTD internal subsets through.
        require(!Regex("""(?is)<!\s*ENTITY\b|<!\s*DOCTYPE\b[^>]*\[""").containsMatchIn(html)) {
            "EPUB 正文包含不受支持的实体定义。"
        }
        var cleaned = html.replace(Regex("""(?is)<!\s*DOCTYPE\b[^>]*>"""), "")
            .replace(Regex("""(?is)^\s*<\?xml\b[^>]*\?>"""), "")
            .replace(Regex("""(?is)<head\b[^>]*>.*?</head\s*>"""), "")
        for (tag in listOf("script", "style", "noscript", "iframe", "object", "svg")) {
            cleaned = cleaned.replace(Regex("(?is)<$tag\\b[^>]*>.*?</$tag\\s*>"), "")
        }
        return cleaned
    }

    private fun spineText(bytes: ByteArray): String {
        val source = cleanedSpineMarkup(bytes.toString(Charsets.UTF_8))
        val text = android.text.Html.fromHtml(source, android.text.Html.FROM_HTML_MODE_LEGACY).toString()
        return text.replace('\u00A0', ' ')
            .replace("\r\n", "\n").replace('\r', '\n')
            .replace(Regex("""[ \t]+\n"""), "\n")
            .replace(Regex("""\n{3,}"""), "\n\n").trim()
    }

    private fun zipEntries(bytes: ByteArray): Map<String, ByteArray> {
        val items = linkedMapOf<String, ByteArray>()
        var total = 0
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory) {
                    val safe = normalize(entry.name)
                    val raw = zip.readNBytes(4 * 1024 * 1024 + 1)
                    require(raw.size <= 4 * 1024 * 1024) { "EPUB 的单个内部文件超过 4 MB。" }
                    total += raw.size
                    require(total <= 80 * 1024 * 1024) { "EPUB 解压数据超过 80 MB。" }
                    items[safe] = raw
                }
                zip.closeEntry()
            }
        }
        return items
    }

    private fun normalize(raw: String): String {
        val components = mutableListOf<String>()
        raw.replace('\\', '/').split('/').forEach { part ->
            when (part) {
                "", "." -> Unit
                ".." -> if (components.isNotEmpty()) components.removeAt(components.lastIndex)
                else -> components.add(part)
            }
        }
        return components.joinToString("/")
    }

    private fun xml(bytes: ByteArray): Document {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = true
        // Android XML providers do not all implement Apache's DOCTYPE feature.
        // Reject DTD directly and separately disable external resolution. Unsupported
        // optional parser flags must not prevent otherwise safe EPUBs from loading.
        val probe = bytes.toString(Charsets.UTF_8).replace("\u0000", "")
        require(!Regex("""<!\s*(?:DOCTYPE|ENTITY)\b""", RegexOption.IGNORE_CASE).containsMatchIn(probe)) {
            "书籍 XML 含不受支持的 DTD 或实体声明，已安全拒绝。"
        }
        runCatching { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
        runCatching { factory.setFeature("http://xml.org/sax/features/external-general-entities", false) }
        runCatching { factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
        runCatching { factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false) }
        runCatching { factory.setAttribute("http://javax.xml.XMLConstants/property/accessExternalDTD", "") }
        runCatching { factory.setAttribute("http://javax.xml.XMLConstants/property/accessExternalSchema", "") }
        runCatching { factory.isXIncludeAware = false }
        factory.isExpandEntityReferences = false
        val builder = factory.newDocumentBuilder()
        builder.setEntityResolver { _, _ -> org.xml.sax.InputSource(java.io.StringReader("")) }
        return builder.parse(ByteArrayInputStream(bytes))
    }
    private fun readMetadataXml(bytes: ByteArray, label: String): Document {
        try {
            return xml(bytes)
        } catch (error: Exception) {
            throw IllegalArgumentException("EPUB 的 $label 格式异常，无法读取书籍目录。", error)
        }
    }

    private fun Document.elements(name: String): List<Element> {
        val nodes = getElementsByTagNameNS("*", name)
        return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }
    }
    private fun epubChapters(bytes: ByteArray): List<Pair<String, String>> {
        val files = zipEntries(bytes)
        val container = files["META-INF/container.xml"] ?: throw IllegalArgumentException("EPUB 缺少书籍入口。")
        val opfPath = readMetadataXml(container, "container.xml").elements("rootfile").firstOrNull()?.getAttribute("full-path")
            ?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("EPUB 目录没有指明正文。")
        val packageFile = files[normalize(opfPath)] ?: throw IllegalArgumentException("EPUB 缺少 OPF 目录。")
        val opf = readMetadataXml(packageFile, "OPF 书籍目录")
        val manifest = opf.elements("item").associate { it.getAttribute("id") to it }
        val prefix = normalize(opfPath).substringBeforeLast('/', "")
        val sections = mutableListOf<Pair<String, String>>()
        for (ref in opf.elements("itemref")) {
            val file = manifest[ref.getAttribute("idref")] ?: continue
            if (!file.getAttribute("media-type").contains("html", ignoreCase = true)) continue
            val href = java.net.URLDecoder.decode(file.getAttribute("href").substringBefore('#'), "UTF-8")
            val source = files[normalize(if (prefix.isBlank()) href else "$prefix/$href")] ?: continue
            val text = spineText(source)
            if (text.isNotBlank()) sections.add("第 ${sections.size + 1} 节" to text)
        }
        require(sections.isNotEmpty()) { "EPUB 中没有可阅读的文字章节。" }
        return sections
    }
    private fun chapterize(sections: List<Pair<String, String>>): List<Pair<String, String>> {
        val output = mutableListOf<Pair<String, String>>()
        var total = 0
        for ((name, body) in sections) {
            val paragraphs = body.replace("\r\n", "\n").split(Regex("\\n\\s*\\n"))
                .flatMap { part -> part.trim().chunked(PARAGRAPH_CHARS) }.filter { it.isNotBlank() }
            val buffer = mutableListOf<String>()
            var current = 0
            var partNumber = 1
            fun flush() {
                if (buffer.isEmpty()) return
                output.add((if (partNumber == 1) name else "$name · ${partNumber}") to buffer.joinToString("\n\n"))
                buffer.clear(); current = 0; partNumber++
            }
            for (paragraph in paragraphs) {
                total += paragraph.length
                require(total <= TEXT_LIMIT) { "单本最多支持 1,200 万字，不会截断后面的章节。" }
                if (current > 0 && current + paragraph.length + 2 > CHAPTER_CHARS) flush()
                buffer.add(paragraph); current += paragraph.length + 2
            }
            flush()
            require(output.size <= CHAPTER_LIMIT) { "单本最多支持 2,048 个正文分段，不会截断。" }
        }
        require(output.isNotEmpty()) { "没有提取到可阅读的正文。" }
        return output
    }
}
