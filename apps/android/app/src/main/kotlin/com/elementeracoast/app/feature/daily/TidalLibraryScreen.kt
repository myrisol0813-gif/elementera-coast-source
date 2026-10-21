package com.elementeracoast.app.feature.daily

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import androidx.compose.ui.platform.LocalContext

private fun JsonObject.s(name: String): String = this[name]?.jsonPrimitive?.contentOrNull.orEmpty()
private fun JsonObject.n(name: String): Int = this[name]?.jsonPrimitive?.intOrNull ?: 0
internal fun JsonObject.hasLibraryCover(): Boolean = this["has_cover"]?.jsonPrimitive?.contentOrNull in setOf("1", "true")
private fun JsonObject.rows(name: String): List<JsonObject> = (this[name] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

private enum class LibraryPage { Shelf, Chapter, Notes }
@Composable
fun TidalLibraryScreen(
    repository: SideRoomsRepository,
    onSnackbar: (String) -> Unit,
    importRequest: Int = 0,
    onShelfChanged: (Boolean) -> Unit = {},
    onReadingChromeChanged: (Boolean) -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf(LibraryPage.Shelf) }
    var books by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var bookId by remember { mutableStateOf("") }
    var book by remember { mutableStateOf<JsonObject?>(null) }
    var notes by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var loadedNotesKey by remember { mutableStateOf("") }
    var chapter by remember { mutableStateOf<JsonObject?>(null) }
    var index by remember { mutableIntStateOf(0) }
    var start by remember { mutableIntStateOf(0) }
    var focus by remember { mutableIntStateOf(-1) }
    var loading by remember { mutableStateOf(true) }
    var importing by remember { mutableStateOf<String?>(null) }
    var pendingCoverBook by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    var writeNote by remember { mutableStateOf(false) }
    var editingNote by remember { mutableStateOf<JsonObject?>(null) }
    var annotationParagraph by remember { mutableIntStateOf(-1) }
    var pendingBookDelete by remember { mutableStateOf(false) }
    var pendingNoteDelete by remember { mutableStateOf<JsonObject?>(null) }

    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val id=pendingCoverBook
        pendingCoverBook=null
        if(uri!=null && !id.isNullOrBlank()) scope.launch {
            try {
                val jpeg=prepareTidalCover(context,uri)
                repository.saveBookCover(id,jpeg)
                revision++
                onSnackbar("封面已经留在书房里了。")
            }catch(error: Exception) { onSnackbar("封面没有保存：${error.message}") }
        }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            loading = true
            try {
                importing = "正在提取正文…"
                val request = LibraryImport.parse(context, uri)
                val result = repository.importBook(request) { current, total ->
                    importing = "正在收书：$current / $total 个正文分段"
                }
                bookId = result.s("id")
                index = 0
                focus = 0
                page = LibraryPage.Chapter
                revision++
                onSnackbar("书籍已经放进潮中书房。")
            } catch (error: Exception) { onSnackbar("导入失败：${error.message}") }
            finally { loading = false; importing = null }
        }
    }
    LaunchedEffect(page) {
        onShelfChanged(page == LibraryPage.Shelf)
        onReadingChromeChanged(page != LibraryPage.Chapter)
    }
    LaunchedEffect(importRequest) {
        if (importRequest > 0 && page == LibraryPage.Shelf) {
            filePicker.launch(arrayOf("*/*"))
        }
    }
    BackHandler(enabled = page != LibraryPage.Shelf) {
        page = if (page == LibraryPage.Notes) LibraryPage.Chapter else LibraryPage.Shelf
    }
    LaunchedEffect(page, bookId, index, start, revision) {
        loading = true
        try {
            when (page) {
                LibraryPage.Shelf -> { books = repository.books().rows("books") }
                LibraryPage.Notes -> {
                    if (book?.s("id") != bookId) book = repository.book(bookId)["book"]?.jsonObject
                    notes = repository.notes(bookId).rows("notes")
                    loadedNotesKey = "$bookId:$revision"
                }
                LibraryPage.Chapter -> {
                    if (book?.s("id") != bookId) book = repository.book(bookId)["book"]?.jsonObject
                    chapter = repository.fullChapter(bookId, index)["chapter"]?.jsonObject
                    if (loadedNotesKey != "$bookId:$revision") {
                        notes = repository.notes(bookId).rows("notes")
                        loadedNotesKey = "$bookId:$revision"
                    }
                }
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { onSnackbar("潮中书房暂时无法读取：${error.message}") }
        finally { loading = false }
    }
    LaunchedEffect(page, bookId, index, chapter) {
        if (page == LibraryPage.Chapter && chapter != null) {
            val count = book?.rows("chapters")?.size ?: 0
            for (neighbor in listOf(index + 1, index - 1)) {
                if (neighbor !in 0 until count) continue
                try { repository.fullChapter(bookId, neighbor) }
                catch (error: CancellationException) { throw error }
                catch (_: Exception) { /* Nonessential prefetch; actual page reports failures. */ }
            }
        }
    }
    fun openBook(entry: JsonObject) {
        if (bookId != entry.s("id")) { book = null; chapter = null }
        loadedNotesKey = ""
        bookId = entry.s("id")
        index = entry["reader_chapter_index"]?.jsonPrimitive?.intOrNull ?: 0
        focus = entry["reader_paragraph_index"]?.jsonPrimitive?.intOrNull ?: 0
        page = LibraryPage.Chapter
    }
    fun openChapter(chapterIndex: Int, paragraph: Int = 0) {
        chapter = null
        index = chapterIndex; start = 0
        focus = paragraph; page = LibraryPage.Chapter
    }
    fun edit(note: JsonObject?, paragraph: Int = -1) {
        editingNote = note; annotationParagraph = paragraph; writeNote = true
    }
    val surface = Modifier.fillMaxSize()
        .then(if (page == LibraryPage.Chapter) Modifier else Modifier.verticalScroll(rememberScrollState()))
        .padding(horizontal = if (page == LibraryPage.Chapter) 0.dp else 18.dp)
        .padding(top = if (page == LibraryPage.Chapter) 0.dp else 88.dp, bottom = 15.dp)
    Column(surface, verticalArrangement = Arrangement.spacedBy(if(page==LibraryPage.Chapter) 0.dp else 13.dp)) {
        when (page) {
            LibraryPage.Shelf -> {
                Text("这里是属于你的书房，可以保存笔迹。", style = MaterialTheme.typography.bodyMedium)
                Text("支持 EPUB 和 TXT 文字阅读，暂不支持 PDF、图片与复杂版式。源文件最多 80 本书；单个文件最多 40 MB、正文最多 1,200 万字、2,048 个正文分段；批注最多 4,000 字，封面压缩后最多 600 KB。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                importing?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (books.isEmpty() && !loading) Text("书架还空着。挑一本我们一起读的书吧。")
                books.forEach { entry ->
                    DailySurfaceCard(onClick = { openBook(entry) }) {
                        Row(modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                            Column(modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                Text(entry.s("title"), fontWeight = FontWeight.SemiBold,
                                    style = MaterialTheme.typography.bodyMedium)
                                Text("${entry.s("format").uppercase()} · ${entry.n("chapters_count")} 个正文分段",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                val chapterIndex=entry["reader_chapter_index"]?.jsonPrimitive?.intOrNull
                                val chapterCount=entry.n("chapters_count").coerceAtLeast(1)
                                val percent=if(chapterIndex==null)0f else (chapterIndex+1).toFloat()/chapterCount
                                androidx.compose.material3.LinearProgressIndicator(
                                    progress={percent.coerceIn(0f,1f)},
                                    modifier=Modifier.fillMaxWidth(),
                                    color=androidx.compose.ui.graphics.Color(0xFFB99A66)
                                )
                                Text(if(chapterIndex==null)"阅读进度 · 尚未开始"
                                    else "阅读进度 · 第 ${chapterIndex+1} / ${chapterCount} 个分段",
                                    style = MaterialTheme.typography.labelSmall,
                                    color=MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("屋主 · ${entry.n("owner_notes")} 条批注与读后感",
                                    style=MaterialTheme.typography.labelSmall)
                                Text("模型伙伴 · ${entry.n("assistant_notes")} 条批注与读后感",
                                    style=MaterialTheme.typography.labelSmall)
                            }
                            TidalCoverSlot(
                                bookId=entry.s("id"),
                                hasCover=entry.hasLibraryCover(),
                                revision=revision,
                                repository=repository,
                                onClick={
                                    pendingCoverBook=entry.s("id")
                                    coverPicker.launch("image/*")
                                }
                            )
                        }
                    }
                }
            }
            LibraryPage.Chapter -> {
                val pageData = chapter
                val currentBook = book
                if (pageData != null && currentBook != null) {
                    TidalPagedReader(
                        bookTitle = currentBook.s("title"),
                        chapterTitle = pageData.s("chapter_title"),
                        chapterIndex = index,
                        chapters = currentBook.rows("chapters"),
                        paragraphs = pageData.rows("paragraphs"),
                        notes = notes,
                        initialParagraph = focus,
                        onChapter = { chapterIndex, lastPage -> openChapter(chapterIndex, if(lastPage) -1 else 0) },
                        onHighlight = { paragraph, from, to ->
                            scope.launch {
                                try {
                                    repository.writeNote(bookId, buildJsonObject {
                                        put("kind", "highlight")
                                        put("chapter_index", index)
                                        put("paragraph_index", paragraph)
                                        put("start_offset", from)
                                        put("end_offset", to)
                                    })
                                    revision++
                                    onSnackbar("这一句已经划线了。")
                                } catch (error: Exception) { onSnackbar("划线失败：${error.message}") }
                            }
                        },
                        onNote = { edit(it) },
                        onProgress = { paragraph ->
                            scope.launch {
                                try { repository.progress(bookId, index, paragraph) }
                                catch (error: Exception) { onSnackbar("阅读进度未保存：${error.message}") }
                            }
                        },
                        onShowNotes = { page = LibraryPage.Notes },
                        onExit = { page = LibraryPage.Shelf },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
            LibraryPage.Notes -> {
                TextButton(onClick = { page = LibraryPage.Chapter }) { Text("‹ 返回正文") }
                Text("批注与读后感",style=MaterialTheme.typography.titleLarge)
                TextButton(onClick = { edit(null) }) { Text("＋ 写一篇读后感") }
                for (author in listOf("owner","assistant")) {
                    Text(if (author=="owner") "屋主的笔记" else "模型伙伴 的笔记", fontWeight = FontWeight.Bold)
                    notes.filter { it.s("author")==author && it.s("kind") != "highlight" }.forEach { note ->
                        NoteBlock(note, onJump = {
                            if (note.s("kind")=="annotation") openChapter(note.n("chapter_index"),note.n("paragraph_index"))
                        },onEdit={edit(note)},onDelete={pendingNoteDelete=note})
                    }
                }
                TextButton(onClick = { pendingBookDelete = true }) { Text("删除整本书及全部笔记") }
            }
        }
        if (loading) Text("正在翻阅海岸书房…",color=MaterialTheme.colorScheme.onSurfaceVariant)
    }

    if (writeNote) {
        val current=editingNote
        var body by remember(current,annotationParagraph) { mutableStateOf(current?.s("body").orEmpty()) }
        val kind=current?.s("kind") ?: if (annotationParagraph >= 0) "annotation" else "reflection"
        AlertDialog(
            onDismissRequest = { writeNote = false }, title = { Text(if (kind=="annotation" || kind=="highlight") "书页边写字" else "留一篇读后感") },
            text = { DailyField("正文 · 1—4000 字",body,{body=it.take(4000)},minLines=5,maxLines=10) },
            confirmButton = { TextButton(onClick = {
                if(body.isBlank()){onSnackbar("先写一点批注。");return@TextButton}
                scope.launch {
                    try {
                        if(current!=null)repository.editNote(current.s("id"),buildJsonObject { put("body",body) })
                        else repository.writeNote(bookId,buildJsonObject {
                            put("kind",kind);put("body",body)
                            if(kind=="annotation"){
                                put("chapter_index",index);put("paragraph_index",annotationParagraph)
                            }
                        })
                        writeNote=false;revision++
                        onSnackbar("屋主的笔记已经留在书页边上。")
                    } catch (e: Exception) {onSnackbar("笔记未保存：${e.message}")}
                }
            }) { Text("保存") } },
            dismissButton = {TextButton(onClick={writeNote=false}){Text("取消")} }
        )
    }
    pendingNoteDelete?.let { note ->
        AlertDialog(onDismissRequest = { pendingNoteDelete = null },
            title={Text("删去这条笔记？")},
            text={Text(note.s("body"))},
            confirmButton={TextButton(onClick={
                pendingNoteDelete=null
                scope.launch { try {repository.deleteNote(note.s("id"));revision++}
                    catch(e:Exception){onSnackbar("删除失败：${e.message}")} }
            }){Text("删除")}},
            dismissButton={TextButton(onClick={pendingNoteDelete=null}){Text("取消")}}
        )
    }
    if(pendingBookDelete) {
        AlertDialog(onDismissRequest={pendingBookDelete=false},title={Text("删除这本书？")},
            text={Text("将连同 模型伙伴 和屋主在这里写的全部批注、读后感与阅读进度一起删除，无法撤销。")},
            confirmButton={TextButton(onClick={
                pendingBookDelete=false;scope.launch{
                    try{repository.deleteBook(bookId);page=LibraryPage.Shelf;revision++}
                    catch(e:Exception){onSnackbar("删除失败：${e.message}")}
                }
            }){Text("确认删除")}},
            dismissButton={TextButton(onClick={pendingBookDelete=false}){Text("保留书籍")}})
    }
}

@Composable
private fun NoteBlock(note: JsonObject, onJump:()->Unit, onEdit:()->Unit, onDelete:()->Unit) {
    val isHuman=note.s("author")=="owner"
    Column(verticalArrangement=Arrangement.spacedBy(6.dp)){
        Text("${if(isHuman)"屋主" else "模型伙伴"} · ${if(note.s("kind")=="annotation")"批注" else "读后感"}",
            style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(note.s("kind")=="annotation") Text(
            note.s("quote").take(180),modifier=Modifier.clickable(onClick=onJump),
            style=MaterialTheme.typography.bodySmall.copy(color=MaterialTheme.colorScheme.primary,textDecoration=TextDecoration.Underline))
        Text(note.s("body"),style=MaterialTheme.typography.bodyMedium)
        if(isHuman) Row {
            TextButton(onClick=onEdit){Text("编辑")}
            TextButton(onClick=onDelete){Text("删除")}
        }
    }
}
