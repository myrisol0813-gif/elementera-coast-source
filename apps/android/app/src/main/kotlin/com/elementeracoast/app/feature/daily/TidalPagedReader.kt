package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import com.elementeracoast.app.ui.theme.LocalCoastAppearance
import com.elementeracoast.app.ui.theme.CoastFontMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

private fun JsonObject.field(key: String): String = this[key]?.jsonPrimitive?.contentOrNull.orEmpty()
private fun JsonObject.intField(key: String): Int? = this[key]?.jsonPrimitive?.intOrNull

private data class ReaderPalette(val id: String, val name: String, val paper: Color, val ink: Color, val highlight: Color)
private val palettes = listOf(
    ReaderPalette("paper", "暖纸", Color(0xFFF9F3E8), Color(0xFF3B4551), Color(0xFFEADB99)),
    ReaderPalette("white", "素白", Color.White, Color(0xFF293847), Color(0xFFF3DF9B)),
    ReaderPalette("blue", "雾蓝", Color(0xFFEDF4F8), Color(0xFF30475B), Color(0xFFD9D4A3)),
    ReaderPalette("night", "夜读", Color(0xFF222B39), Color(0xFFE6E4DC), Color(0xFF71603F))
)

@Composable
internal fun TidalPagedReader(
    bookTitle: String,
    chapterTitle: String,
    chapterIndex: Int,
    chapters: List<JsonObject>,
    paragraphs: List<JsonObject>,
    notes: List<JsonObject>,
    initialParagraph: Int,
    initialOffset: Int,
    onChapter: (Int, Boolean) -> Unit,
    onHighlight: (paragraphIndex: Int, start: Int, end: Int) -> Unit,
    onNote: (JsonObject) -> Unit,
    onProgress: (paragraphIndex: Int, textOffset: Int) -> Unit,
    onShowNotes: () -> Unit,
    onExit: () -> Unit,
    onReadingChromeChanged: (Boolean) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val pref = remember(context.applicationContext) {
        context.applicationContext.getSharedPreferences("coast_reader_appearance", android.content.Context.MODE_PRIVATE)
    }
    var paletteId by remember { mutableStateOf(pref.getString("color", "paper").orEmpty()) }
    var fontSize by remember { mutableIntStateOf(pref.getInt("fontSize", 15).coerceIn(14, 17)) }
    val palette = palettes.find { it.id == paletteId } ?: palettes.first()
    val appearance=LocalCoastAppearance.current
    val readingFamily=appearance.readingFontFamily
    val readingWeight=appearance.readingWeight.fontWeight
    var chromeVisible by remember(chapterIndex) { mutableStateOf(false) }
    LaunchedEffect(chromeVisible) { onReadingChromeChanged(chromeVisible) }
    var tocOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    val raw = remember(paragraphs) { paragraphs.map { (it.intField("index") ?: 0) to it.field("text") } }
    // Observe tap candidates during Initial pass: read-only BasicTextField handles
    // text selection itself at Main pass, but it must not swallow the chrome gesture.
    // Never consume events, so selection and horizontal paging still work.
    val toggleOnShortTap = Modifier.pointerInput(chapterIndex) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val started = android.os.SystemClock.uptimeMillis()
            var moved = false
            var lifted = false
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val pointer = event.changes.firstOrNull { it.id == down.id } ?: break
                if ((pointer.position - down.position).getDistance() > viewConfiguration.touchSlop) moved = true
                if (!pointer.pressed) {
                    lifted = pointer.previousPressed
                    break
                }
            }
            val shortTap = android.os.SystemClock.uptimeMillis() - started < 320L
            // Leave visible toolbars and their menu controls fully interactive.
            val inControls = chromeVisible && (down.position.y < 74.dp.toPx() ||
                down.position.y > size.height - 66.dp.toPx())
            if (lifted && !moved && shortTap && !inControls) chromeVisible = !chromeVisible
        }
    }
    BoxWithConstraints(modifier = modifier.fillMaxSize().background(palette.paper).then(toggleOnShortTap)) {
        val charPerLine=(maxWidth.value / (fontSize*0.97f)).toInt().coerceIn(12,50)
        val visibleLines=(maxHeight.value/(fontSize*1.77f)).toInt().coerceIn(10,65)
        val budget=(charPerLine*(visibleLines-2)).coerceIn(180,1200)
        val pages=remember(raw,fontSize,budget) { paginateTidalChapter(raw,budget) }
        val initial=remember(pages,initialParagraph,initialOffset) {
            if(initialParagraph<0)pages.lastIndex else tidalPageFor(pages,initialParagraph,initialOffset)
        }
        val hasPrevious=chapterIndex>0
        val hasNext=chapterIndex<chapters.size-1
        val offset=if(hasPrevious)1 else 0
        val total=pages.size+offset+if(hasNext)1 else 0
        val pager=rememberPagerState(initialPage=initial+offset,pageCount={total})
        val scope=rememberCoroutineScope()
        // The server refreshes note data after saving a highlight/annotation.
        // Never scroll back to the old initial anchor just because it recomposed.
        LaunchedEffect(chapterIndex,fontSize,budget) {
            pager.scrollToPage((initial+offset).coerceIn(0,total-1))
        }
        LaunchedEffect(chapterIndex,pager.currentPage) {
            when {
                hasPrevious && pager.currentPage==0 -> onChapter(chapterIndex-1,true)
                hasNext && pager.currentPage==total-1 -> onChapter(chapterIndex+1,false)
                else -> pages.getOrNull(pager.currentPage-offset)?.lastOrNull()?.let {
                    onProgress(it.paragraphIndex,it.start)
                }
            }
        }
        HorizontalPager(
            state=pager,
            modifier=Modifier.fillMaxSize(),
            beyondViewportPageCount=1
        ) { position ->
            val page=position-offset
            if(page !in pages.indices) {
                Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) {
                    Text("正在翻向相邻章节…",color=palette.ink.copy(alpha=.5f),fontSize=12.sp)
                }
            } else Column(
                modifier=Modifier.fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal=20.dp,vertical=26.dp),
                verticalArrangement=Arrangement.spacedBy(10.dp)
            ) {
                if(page==0 && !Regex("^第\\s*\\d+\\s*节$").matches(chapterTitle)) {
                    Text(chapterTitle,fontSize=(fontSize+2).sp,
                        fontFamily=readingFamily,fontWeight=FontWeight.Medium,
                        color=palette.ink,modifier=Modifier.padding(bottom=12.dp))
                }
                pages[page].forEach { piece ->
                    SelectableBookText(
                        fragment=piece,
                        notes=notes.filter {
                            it.intField("chapter_index")==chapterIndex &&
                                it.intField("paragraph_index")==piece.paragraphIndex
                        },
                        ink=palette.ink,highlight=palette.highlight,fontSize=fontSize,
                        fontFamily=readingFamily,fontWeight=readingWeight,
                        onHighlight={start,end->onHighlight(piece.paragraphIndex,start,end)},
                        onNote=onNote
                    )
                }
            }
        }
        if(chromeVisible) {
            Row(
                modifier=Modifier.fillMaxWidth().align(Alignment.TopCenter)
                    .background(palette.paper.copy(alpha=.98f)).padding(horizontal=12.dp,vertical=5.dp),
                horizontalArrangement=Arrangement.SpaceBetween,
                verticalAlignment=Alignment.CenterVertically
            ) {
                TextButton(onClick=onExit) { Text("‹ 书架",color=palette.ink) }
                Box {
                    TextButton(onClick={tocOpen=true}) { Text("目录",color=palette.ink) }
                    DropdownMenu(expanded=tocOpen,onDismissRequest={tocOpen=false}) {
                        chapters.forEach { chapter ->
                            DropdownMenuItem(text={Text(chapter.field("title"),style=MaterialTheme.typography.bodySmall)},
                                onClick={tocOpen=false;onChapter(chapter.intField("chapter_index")?:0,false)})
                        }
                    }
                }
                TextButton(onClick=onShowNotes) { Text("笔记",color=palette.ink) }
                Box {
                    TextButton(onClick={settingsOpen=true}) { Text("纸色 · Aa",color=palette.ink) }
                    DropdownMenu(expanded=settingsOpen,onDismissRequest={settingsOpen=false}) {
                        palettes.forEach { option ->
                            DropdownMenuItem(text={Text(option.name)},onClick={
                                paletteId=option.id
                                pref.edit().putString("color",option.id).apply()
                                settingsOpen=false
                            })
                        }
                        listOf(14,15,16,17).forEach { point ->
                            DropdownMenuItem(text={Text("字号 $point")},onClick={
                                fontSize=point
                                pref.edit().putInt("fontSize",point).apply()
                                settingsOpen=false
                            })
                        }
                    }
                }
            }
        }
        if(chromeVisible) {
            Row(
                modifier=Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .background(palette.paper.copy(alpha=.98f)),
                horizontalArrangement=Arrangement.SpaceBetween,
                verticalAlignment=Alignment.CenterVertically
            ) {
                TextButton(enabled=pager.currentPage>0,onClick={
                    scope.launch { pager.animateScrollToPage(pager.currentPage-1) }
                }) {Text("‹",color=palette.ink)}
                Text("第 ${(pager.currentPage-offset+1).coerceIn(1,pages.size)} / ${pages.size} 页",fontSize=11.sp,
                    color=palette.ink.copy(alpha=.6f))
                TextButton(enabled=pager.currentPage<total-1,onClick={
                    scope.launch { pager.animateScrollToPage(pager.currentPage+1) }
                }) {Text("›",color=palette.ink)}
            }
        }
    }
}

@Composable
private fun SelectableBookText(
    fragment: TidalSegment,
    notes: List<JsonObject>,
    ink: Color,
    highlight: Color,
    fontSize: Int,
    fontFamily: FontFamily?,
    fontWeight: FontWeight,
    onHighlight: (Int, Int) -> Unit,
    onNote: (JsonObject) -> Unit
) {
    val clipboard = LocalClipboardManager.current
    val decorated = remember(fragment, notes, highlight) {
        buildAnnotatedString {
            append(fragment.text)
            notes.forEach { note ->
                val begin = note.intField("start_offset") ?: return@forEach
                val end = note.intField("end_offset") ?: return@forEach
                val from = maxOf(begin, fragment.start) - fragment.start
                val to = minOf(end, fragment.end) - fragment.start
                if (to > from) addStyle(SpanStyle(background = highlight), from, to)
            }
        }
    }
    var textValue by remember(decorated) { mutableStateOf(TextFieldValue(decorated, TextRange.Zero)) }
    var selected by remember { mutableStateOf<TextRange?>(null) }
    var tappedNote by remember { mutableStateOf<JsonObject?>(null) }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box {
            BasicTextField(
                value = textValue,
                onValueChange = { changed ->
                    textValue = changed.copy(annotatedString = decorated)
                    val range = changed.selection
                    if (!range.collapsed) {
                        selected = range
                        tappedNote = null
                    } else {
                        selected = null
                        val point = fragment.start + range.start
                        tappedNote = notes.firstOrNull { note ->
                            val from = note.intField("start_offset")
                            val to = note.intField("end_offset")
                            from != null && to != null && point in from until to
                        }
                    }
                },
                readOnly = true,
                textStyle = androidx.compose.ui.text.TextStyle(
                    color = ink,
                    fontSize = fontSize.sp,
                    lineHeight = (fontSize * 1.73f).sp,
                    letterSpacing = if (LocalCoastAppearance.current.fontMode == CoastFontMode.ChillHuoSong) .5.sp else .02.sp,
                    fontFamily = fontFamily,
                    fontWeight = fontWeight
                ),
                modifier = Modifier.fillMaxWidth()
            )
            DropdownMenu(expanded = selected != null, onDismissRequest = { selected = null }) {
                DropdownMenuItem(text = { Text("复制") }, onClick = {
                    selected?.let { range ->
                        val from = range.min.coerceIn(0, fragment.text.length)
                        val end = range.max.coerceIn(from, fragment.text.length)
                        clipboard.setText(AnnotatedString(fragment.text.substring(from, end)))
                    }
                    selected = null
                })
                DropdownMenuItem(text = { Text("划线") }, onClick = {
                    selected?.let { range ->
                        val from = range.min.coerceIn(0, fragment.text.length)
                        val end = range.max.coerceIn(from, fragment.text.length)
                        if (end > from) onHighlight(fragment.start + from, fragment.start + end)
                    }
                    selected = null
                })
            }
            DropdownMenu(expanded = tappedNote != null, onDismissRequest = { tappedNote = null }) {
                tappedNote?.let { note ->
                    DropdownMenuItem(text = {
                        Column {
                            Text(if (note.field("author") == "owner") "屋主的划线" else "模型伙伴 的划线",
                                style = MaterialTheme.typography.labelSmall)
                            if (note.field("body").isNotBlank()) Text(note.field("body"))
                        }
                    }, onClick = { tappedNote = null })
                    if (note.field("author") == "owner") {
                        DropdownMenuItem(text = { Text(if (note.field("kind") == "highlight") "写批注" else "编辑批注") },
                            onClick = { tappedNote = null; onNote(note) })
                    }
                }
            }
        }
        // Preserve legacy paragraph-level annotations on their original page.
        if (fragment.start == 0) notes.filter {
            it.field("kind") == "annotation" && it.intField("start_offset") == null
        }.forEach { note ->
            Text("${if (note.field("author") == "owner") "屋主" else "模型伙伴"}：${note.field("body")}",
                fontSize = 12.sp, lineHeight = 19.sp, color = ink.copy(alpha = .77f))
        }
    }
}
