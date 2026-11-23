package com.elementeracoast.app.feature.daily

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Slider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.elementeracoast.app.core.model.ChatSearchHit
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private fun JsonObject.vaultText(name: String): String =
    this[name]?.jsonPrimitive?.contentOrNull.orEmpty()

private fun JsonObject.vaultFlag(name: String): Boolean =
    this[name]?.jsonPrimitive?.booleanOrNull == true

private fun JsonObject.vaultItems(name: String): List<JsonObject> =
    (this[name] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

private fun vaultTime(millis: Int): String {
    val seconds = millis.coerceAtLeast(0) / 1000
    return (seconds / 60).toString() + ":" + (seconds % 60).toString().padStart(2, '0')
}

private val basicKinds = listOf("all" to "全部", "image" to "影像", "audio" to "声音", "file" to "文件")
private val treasureKinds = listOf("all" to "全部", "writing" to "文字", "image" to "影像",
    "audio" to "声音", "other" to "其他")

internal fun vaultSection(kind: String, treasure: Boolean): String = when (kind) {
    "image" -> "影像"
    "audio" -> "声音"
    "file" -> if (treasure) "其他" else "文件"
    "text", "soil" -> "文字"
    else -> "其他"
}

private fun vaultSectionOrder(treasure: Boolean): List<String> =
    if (treasure) listOf("文字", "影像", "声音", "其他")
    else listOf("影像", "声音", "文件")

internal fun vaultVisibleRows(rows: List<JsonObject>, mode: String, kind: String): List<JsonObject> {
    if (mode != "treasures") return rows
    return when (kind) {
        "writing" -> rows.filter { it.vaultText("kind") == "text" || it.vaultText("kind") == "soil" }
        "other" -> rows.filter { it.vaultText("kind") == "file" }
        else -> rows
    }
}

/** Read-only gallery index over canonical Coast media; no duplicate data store. */
@Composable
fun CoastVaultScreen(repository: SideRoomsRepository, onSnackbar: (String) -> Unit,
    onOpenSource: (ChatSearchHit) -> Unit) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("basic") }
    var kind by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    var submittedQuery by remember { mutableStateOf("") }
    var revision by remember { mutableIntStateOf(0) }
    var rows by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var nextCursor by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }

    suspend fun load(cursor: String = "") {
        loading = true
        failure = ""
        try {
            // "writing" and "other" are view groups, never invented backend filters.
            // Preserve the real backend cursor so users can reach every subsequent page.
            val remoteKind = if (kind == "writing" || kind == "other") "all" else kind
            val response = if (mode == "basic") {
                repository.vaultMedia(remoteKind, submittedQuery, cursor)
            } else repository.vaultTreasures(remoteKind, submittedQuery, cursor)
            val received = response.vaultItems("items")
            rows = if (cursor.isBlank()) received else rows + received
            nextCursor = response.vaultText("next_cursor")
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (error: Exception) {
            failure = error.message ?: "无法读取海岸文件库。"
            if (cursor.isBlank()) rows = emptyList()
        } finally {
            loading = false
        }
    }

    LaunchedEffect(mode, kind, submittedQuery, revision) { load() }
    val labels = if (mode == "basic") basicKinds else treasureKinds
    val visibleRows = vaultVisibleRows(rows, mode, kind)
    val groupOrder = if (kind == "all") vaultSectionOrder(mode == "treasures")
        else vaultSectionOrder(mode == "treasures").filter { name ->
            when (kind) {
                "writing" -> name == "文字"
                "other" -> name == "其他"
                else -> name == vaultSection(kind, mode == "treasures")
            }
        }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.padding(start = 18.dp, end = 18.dp, top = 14.dp)
    ) {
        item(key = "controls") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("basic" to "基本文件库", "treasures" to "拾潮").forEach { (value, title) ->
                        SnowLetterSurface(
                            modifier = Modifier.weight(1f).height(44.dp).clickable {
                                if (mode != value) {
                                    mode = value
                                    kind = "all"
                                    query = ""
                                    submittedQuery = ""
                                    rows = emptyList()
                                }
                            },
                            role = SnowLetterSurfaceRole.StatusCard,
                            fallbackColor = if (mode == value) MaterialTheme.colorScheme.secondaryContainer
                                else MaterialTheme.colorScheme.surface,
                            fallbackShape = RoundedCornerShape(18.dp),
                            fallbackElevation = if (mode == value) 2.dp else 1.dp,
                            contentAlignment = Alignment.Center
                        ) {
                            Text(title, fontWeight = if (mode == value) FontWeight.SemiBold else FontWeight.Normal,
                                style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                SnowLetterSurface(
                    modifier = Modifier.fillMaxWidth(),
                    role = SnowLetterSurfaceRole.StatusCard,
                    fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                    fallbackShape = RoundedCornerShape(20.dp),
                    fallbackElevation = 1.dp
                ) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("检索", fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.titleSmall)
                        SnowLetterSurface(
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            role = SnowLetterSurfaceRole.ComposerField,
                            fallbackColor = MaterialTheme.colorScheme.surface,
                            fallbackShape = RoundedCornerShape(16.dp)
                        ) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.weight(1f)) {
                                    BasicTextField(
                                        value = query, onValueChange = { query = it.take(100) },
                                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                                        textStyle = MaterialTheme.typography.bodyMedium.copy(
                                            color = MaterialTheme.colorScheme.onSurface
                                        ),
                                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                                        decorationBox = { inner ->
                                            Box {
                                                if (query.isEmpty()) Text("搜索文件、语音或备注",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                inner()
                                            }
                                        }
                                    )
                                }
                                TextButton(onClick = { submittedQuery = query; revision++ }) {
                                    Text("搜索")
                                }
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            labels.forEach { (value, title) ->
                                val selected = kind == value
                                Box(
                                    modifier = Modifier.weight(1f).height(36.dp)
                                        .background(
                                            if (selected) MaterialTheme.colorScheme.secondaryContainer
                                            else MaterialTheme.colorScheme.surface,
                                            RoundedCornerShape(16.dp)
                                        )
                                        .clickable { kind = value; rows = emptyList() },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(title, style = MaterialTheme.typography.labelMedium,
                                        color = if (selected) MaterialTheme.colorScheme.onSurface
                                            else MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1, textAlign = TextAlign.Center)
                                }
                            }
                        }
                    }
                }
                if (failure.isNotBlank()) Text("读取失败：" + failure,
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (loading && rows.isEmpty()) Text("正在寻找海岸里的记录…",
                    style = MaterialTheme.typography.bodySmall)
                if (!loading && visibleRows.isEmpty() && failure.isBlank()) Text(
                    if (mode == "basic") "这里还没有符合条件的已存媒体。"
                    else "还没有符合条件的拾潮记录。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        groupOrder.forEach { name ->
            val sectionRows = visibleRows.filter { vaultSection(it.vaultText("kind"), mode == "treasures") == name }
            if (sectionRows.isNotEmpty()) {
                item(key = "section-" + name) {
                    Row(Modifier.fillMaxWidth().padding(top = 5.dp, bottom = 1.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(sectionRows.size.toString() + " 项",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (name == "影像") {
                    items(sectionRows.chunked(2), key = { "image-row-" + it.first().vaultText("id") }) { pair ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            pair.forEach { entry ->
                                Box(Modifier.weight(1f)) {
                                    CoastVaultCard(entry, mode == "treasures", repository,
                                        onSnackbar, onOpenSource, onChanged = { revision++ })
                                }
                            }
                            if (pair.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                } else {
                    items(sectionRows, key = { "item-" + it.vaultText("id") }) { entry ->
                        CoastVaultCard(entry, mode == "treasures", repository,
                            onSnackbar, onOpenSource, onChanged = { revision++ })
                    }
                }
            }
        }
        if (nextCursor.isNotBlank()) item(key = "more") {
            TextButton(enabled = !loading, onClick = { scope.launch { load(nextCursor) } }) {
                Text(if (loading) "正在继续读取…" else "继续查看下一页")
            }
        }
        item(key = "footnote") {
            Text("媒体来自海岸已保存的原件。取消珍藏不会删除原聊天、图片或声音。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 14.dp))
        }
    }
}

@Composable
private fun CoastVaultCard(
    item: JsonObject,
    treasure: Boolean,
    repository: SideRoomsRepository,
    onSnackbar: (String) -> Unit,
    onOpenSource: (ChatSearchHit) -> Unit,
    onChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val kind = item.vaultText("kind")
    val id = item.vaultText("id")
    val sourceId = if (treasure) item.vaultText("source_id") else id
    val conversation = item.vaultText("conversation_id")
    val sourceText = if (treasure) item.vaultText("excerpt") else item.vaultText("source_text")
    val originalName = item.vaultText("name")
    val heading = when (kind) {
        "audio" -> "已保存语音"
        "soil" -> "原位思维壤"
        "text" -> "文字摘抄"
        else -> originalName.ifBlank { if (kind == "image") "海岸影像" else "海岸附件" }
    }
    var note by remember(id) { mutableStateOf(item.vaultText("notes")) }
    var busy by remember(id) { mutableStateOf(false) }
    var showActions by remember(id) { mutableStateOf(false) }
    var showCancel by remember(id) { mutableStateOf(false) }
    var showInfo by remember(id) { mutableStateOf(false) }
    var showNote by remember(id) { mutableStateOf(false) }
    var showText by remember(id) { mutableStateOf(false) }
    var imageOpen by remember(id) { mutableStateOf<Bitmap?>(null) }
    var pendingBytes by remember(id) { mutableStateOf<ByteArray?>(null) }

    val saveLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val bytes = pendingBytes
        pendingBytes = null
        if (uri != null && bytes != null) {
            try {
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("无法打开所选保存位置。")
                onSnackbar("文件已经保存到手机。")
            } catch (error: Exception) {
                onSnackbar("文件保存失败：" + error.message)
            }
        }
    }

    fun download() {
        scope.launch {
            try {
                val bytes = if (kind == "audio") repository.audio(sourceId)
                    else repository.vaultAttachment(sourceId, conversation)
                pendingBytes = bytes
                saveLauncher.launch(if (kind == "audio") "coast-voice-" + sourceId + ".mp3"
                    else originalName.ifBlank { "海岸附件" })
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) { onSnackbar("下载失败：" + error.message) }
        }
    }

    fun favorite() {
        if (treasure) { showCancel = true; return }
        val savedId = item.vaultText("treasure_id")
        scope.launch {
            busy = true
            try {
                if (item.vaultFlag("favorited") && savedId.isNotBlank()) {
                    repository.vaultRemove(savedId)
                    onSnackbar("已取消珍藏，原媒体仍在。")
                } else {
                    repository.vaultSave(kind, conversation, sourceId, note)
                    onSnackbar("已拾入潮间。")
                }
                onChanged()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) { onSnackbar("珍藏操作失败：" + error.message) }
            finally { busy = false }
        }
    }

    fun openSource() {
        if (conversation.isBlank()) return
        val messageId = item.vaultText("message_id")
        val turnId = item.vaultText("turn_id")
        val role = when (item.vaultText("role")) {
            "user" -> MessageRole.User
            "assistant" -> MessageRole.Assistant
            else -> null
        }
        onOpenSource(ChatSearchHit(
            kind = if (messageId.isNotBlank() && turnId.isNotBlank() && role != null)
                "message" else "conversation",
            conversationId = conversation, conversationTitle = "",
            turnId = turnId, messageId = messageId, role = role,
            snippet = sourceText.take(180)
        ))
    }

    val paperColor = MaterialTheme.colorScheme.surfaceVariant
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth(),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = paperColor,
        fallbackShape = RoundedCornerShape(20.dp),
        fallbackElevation = 1.dp
    ) {
        Column(
            Modifier.fillMaxWidth().padding(if (kind == "image") 9.dp else 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            when (kind) {
                "image" -> {
                    CoastVaultImage(repository, sourceId, conversation, onSnackbar) { imageOpen = it }
                    Text(heading, style = MaterialTheme.typography.labelSmall,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                "audio" -> {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.weight(1f)) {
                            CoastVaultAudio(repository, sourceId, onSnackbar)
                        }
                        Box {
                            TextButton(onClick = { showActions = true }) { Text("展开") }
                            VaultActions(showActions, onDismiss = { showActions = false },
                                treasure = treasure, alreadySaved = item.vaultFlag("favorited"),
                                busy = busy, onFavorite = ::favorite, onSave = ::download,
                                onSource = ::openSource, onInfo = { showInfo = true },
                                onNote = { showNote = true }, onRead = { showText = true },
                                hasMedia = true, hasText = sourceText.isNotBlank())
                        }
                    }
                }
                "file" -> {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(heading, style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold, maxLines = 2,
                                overflow = TextOverflow.Ellipsis)
                            Text("文件包", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Box {
                            TextButton(onClick = { showActions = true }) { Text("展开") }
                            VaultActions(showActions, onDismiss = { showActions = false },
                                treasure = treasure, alreadySaved = item.vaultFlag("favorited"),
                                busy = busy, onFavorite = ::favorite, onSave = ::download,
                                onSource = ::openSource, onInfo = { showInfo = true },
                                onNote = { showNote = true }, onRead = { showText = true },
                                hasMedia = true, hasText = false)
                        }
                    }
                }
                else -> {
                    Text(heading, fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyMedium)
                    Text(sourceText, maxLines = 3, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.fillMaxWidth().clickable { showText = true })
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { showText = true }) { Text("展开阅读") }
                        Box {
                            TextButton(onClick = { showActions = true }) { Text("操作") }
                            VaultActions(showActions, onDismiss = { showActions = false },
                                treasure = treasure, alreadySaved = item.vaultFlag("favorited"),
                                busy = busy, onFavorite = ::favorite, onSave = ::download,
                                onSource = ::openSource, onInfo = { showInfo = true },
                                onNote = { showNote = true }, onRead = { showText = true },
                                hasMedia = false, hasText = sourceText.isNotBlank())
                        }
                    }
                }
            }
        }
    }

    if (imageOpen != null) Dialog(onDismissRequest = { imageOpen = null }) {
        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface,
            RoundedCornerShape(22.dp)).padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { imageOpen = null }) { Text("关闭") }
                Box {
                    TextButton(onClick = { showActions = !showActions }) { Text("···") }
                    VaultActions(showActions, onDismiss = { showActions = false },
                        treasure = treasure, alreadySaved = item.vaultFlag("favorited"),
                        busy = busy, onFavorite = ::favorite, onSave = ::download,
                        onSource = ::openSource, onInfo = { showInfo = true },
                        onNote = { showNote = true }, onRead = { showText = true },
                        hasMedia = true, hasText = false)
                }
            }
            Image(imageOpen!!.asImageBitmap(), contentDescription = "海岸影像原图",
                modifier = Modifier.fillMaxWidth().heightIn(max = 540.dp),
                contentScale = ContentScale.Fit)
        }
    }
    if (showInfo) AlertDialog(
        onDismissRequest = { showInfo = false },
        title = { Text("文件信息") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("名称：" + heading)
                Text("类型：" + kind)
                if (item.vaultText("size").isNotBlank())
                    Text("大小：" + item.vaultText("size") + " 字节")
                Text("来源窗口：" + conversation)
                Text("原件编号：" + sourceId)
            }
        },
        confirmButton = { TextButton(onClick = { showInfo = false }) { Text("关闭") } }
    )
    if (showText) AlertDialog(
        onDismissRequest = { showText = false },
        title = { Text(heading) },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                Text(sourceText, style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = { TextButton(onClick = { showText = false }) { Text("收起") } }
    )
    if (showNote) AlertDialog(
        onDismissRequest = { if (!busy) showNote = false },
        title = { Text("珍藏备注") },
        text = {
            OutlinedTextField(value = note, onValueChange = { note = it.take(1200) },
                modifier = Modifier.fillMaxWidth(), maxLines = 5,
                placeholder = { Text("写一点想留下的话…") })
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                if (treasure) {
                    scope.launch {
                        busy = true
                        try {
                            repository.vaultChangeNote(id, note)
                            onChanged()
                            showNote = false
                            onSnackbar("备注已保存。")
                        } catch (error: Exception) { onSnackbar("保存失败：" + error.message) }
                        finally { busy = false }
                    }
                } else {
                    showNote = false
                    onSnackbar("备注已填写，可从操作菜单拾入潮间时一起保存。")
                }
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = { showNote = false }) { Text("返回") } }
    )
    if (showCancel) AlertDialog(
        onDismissRequest = { showCancel = false },
        title = { Text("取消这条珍藏？") },
        text = { Text("只移除拾潮里的收藏，原聊天和媒体不会删除。") },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                showCancel = false
                scope.launch {
                    busy = true
                    try {
                        repository.vaultRemove(id)
                        onChanged()
                        onSnackbar("已取消珍藏，原资料仍在。")
                    } catch (error: Exception) { onSnackbar("操作失败：" + error.message) }
                    finally { busy = false }
                }
            }) { Text("取消珍藏") }
        },
        dismissButton = { TextButton(onClick = { showCancel = false }) { Text("保留") } }
    )
}

@Composable
private fun VaultActions(
    expanded: Boolean,
    onDismiss: () -> Unit,
    treasure: Boolean,
    alreadySaved: Boolean,
    busy: Boolean,
    onFavorite: () -> Unit,
    onSave: () -> Unit,
    onSource: () -> Unit,
    onInfo: () -> Unit,
    onNote: () -> Unit,
    onRead: () -> Unit,
    hasMedia: Boolean,
    hasText: Boolean
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text(if (treasure || alreadySaved) "取消珍藏" else "拾入潮间") },
            enabled = !busy,
            onClick = { onDismiss(); onFavorite() }
        )
        DropdownMenuItem(text = { Text("备注") }, enabled = !busy,
            onClick = { onDismiss(); onNote() })
        if (hasMedia) DropdownMenuItem(text = { Text("保存文件") }, enabled = !busy,
            onClick = { onDismiss(); onSave() })
        if (hasText) DropdownMenuItem(text = { Text("阅读全文") },
            onClick = { onDismiss(); onRead() })
        DropdownMenuItem(text = { Text("回到来源") },
            onClick = { onDismiss(); onSource() })
        DropdownMenuItem(text = { Text("查看信息") },
            onClick = { onDismiss(); onInfo() })
    }
}

@Composable
private fun CoastVaultImage(
    repository: SideRoomsRepository,
    id: String,
    conversation: String,
    onSnackbar: (String) -> Unit,
    onOpen: (Bitmap) -> Unit
) {
    var bitmap by remember(id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(id, conversation) {
        try {
            val bytes = repository.vaultAttachment(id, conversation)
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (error: Exception) {
            onSnackbar("图片暂时无法预览：" + error.message)
        }
    }
    Box(Modifier.fillMaxWidth().aspectRatio(1f)
        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(13.dp))
        .clickable { bitmap?.let(onOpen) }, contentAlignment = Alignment.Center) {
        bitmap?.let {
            Image(it.asImageBitmap(), contentDescription = "点按放大海岸影像",
                modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                contentScale = ContentScale.Fit)
        } ?: Text("影像", style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CoastVaultAudio(
    repository: SideRoomsRepository,
    id: String,
    onSnackbar: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var player by remember(id) { mutableStateOf<MediaPlayer?>(null) }
    var file by remember(id) { mutableStateOf<File?>(null) }
    var playing by remember(id) { mutableStateOf(false) }
    var durationMs by remember(id) { mutableIntStateOf(0) }
    var progress by remember(id) { mutableStateOf(0f) }
    var seeking by remember(id) { mutableStateOf(false) }
    DisposableEffect(id) {
        onDispose { player?.release(); file?.delete() }
    }
    LaunchedEffect(id, playing, player) {
        while (playing && isActive) {
            if (!seeking) {
                progress = player?.let { active ->
                    runCatching {
                        if (active.duration > 0)
                            (active.currentPosition.toFloat() / active.duration).coerceIn(0f, 1f)
                        else 0f
                    }.getOrDefault(0f)
                } ?: 0f
            }
            delay(180)
        }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        TextButton(onClick = {
            scope.launch {
                try {
                    val active = player
                    when {
                        playing -> {
                            active?.pause()
                            playing = false
                        }
                        active != null -> {
                            if (progress >= 0.999f) {
                                active.seekTo(0)
                                progress = 0f
                            }
                            active.start()
                            playing = true
                        }
                        else -> {
                            val bytes = repository.audio(id)
                            val local = File.createTempFile("coast-vault-", ".mp3", context.cacheDir)
                            local.writeBytes(bytes)
                            file = local
                            val next = MediaPlayer()
                            next.setDataSource(local.absolutePath)
                            next.prepare()
                            durationMs = next.duration
                            next.setOnCompletionListener {
                                playing = false
                                progress = 1f
                            }
                            player = next
                            next.start()
                            playing = true
                        }
                    }
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (error: Exception) { onSnackbar("语音播放失败：" + error.message) }
            }
        }) { Text(if (playing) "暂停" else "播放", style = MaterialTheme.typography.labelSmall) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Slider(
                value = progress,
                onValueChange = { seeking = true; progress = it },
                onValueChangeFinished = {
                    player?.let { active ->
                        if (durationMs > 0) active.seekTo((progress * durationMs).toInt())
                    }
                    seeking = false
                },
                enabled = durationMs > 0,
                modifier = Modifier.fillMaxWidth().height(32.dp)
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(vaultTime((progress * durationMs).toInt()),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (durationMs > 0) vaultTime(durationMs) else "—:—",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
