package com.elementeracoast.app.feature.daily

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
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

internal fun vaultTime(millis: Int): String {
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
    onOpenSource: (ChatSearchHit) -> Unit, guideMode: String? = null, onGuideModeConsumed: () -> Unit = {}) {
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
    val context=LocalContext.current
    var stickerUri by remember{mutableStateOf<android.net.Uri?>(null)}
    var uploadDescription by remember{mutableStateOf("")}
    var uploadBusy by remember{mutableStateOf(false)}
    val chooseSticker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->stickerUri=uri;uploadDescription=""}
    if(stickerUri!=null)AlertDialog(onDismissRequest={if(!uploadBusy)stickerUri=null},title={Text("加入表情包")},text={
        Column(verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text("保存原图，不必发送聊天。",style=MaterialTheme.typography.bodySmall)
            OutlinedTextField(uploadDescription,{uploadDescription=it.take(500)},enabled=!uploadBusy,label={Text("素材说明")})
        }
    },confirmButton={TextButton(enabled=!uploadBusy&&uploadDescription.isNotBlank(),onClick={
        val uri=stickerUri?:return@TextButton
        val desc=uploadDescription
        uploadBusy=true
        scope.launch{
            try{
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){
                    val resolver=context.contentResolver
                    val mime=resolver.getType(uri).orEmpty()
                    val name=resolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),null,null,null)?.use{c->if(c.moveToFirst())c.getString(0)else null}?:"表情包"
                    val bytes=requireNotNull(resolver.openInputStream(uri)).use{input->
                        val out=java.io.ByteArrayOutputStream();val buf=ByteArray(65536);var size=0
                        while(true){val n=input.read(buf);if(n<0)break;size+=n;require(size<=8*1024*1024){"图片超过8 MiB。"};out.write(buf,0,n)}
                        out.toByteArray()
                    }
                    repository.vaultUploadSticker(name,mime,desc,bytes)
                }
                stickerUri=null;uploadDescription="";revision++;onSnackbar("表情包已保存。")
            }catch(c:CancellationException){throw c}catch(e:Exception){onSnackbar("上传未确认完成："+(e.message?:"请刷新目录核对。"))}finally{uploadBusy=false}
        }
    }){Text(if(uploadBusy)"正在保存" else "保存")}},dismissButton={TextButton(enabled=!uploadBusy,onClick={stickerUri=null}){Text("取消")}})

    suspend fun load(cursor: String = "") {
        loading = true
        failure = ""
        try {
            // "writing" and "other" are view groups, never invented backend filters.
            // Preserve the real backend cursor so users can reach every subsequent page.
            val remoteKind = if (kind == "writing" || kind == "other") "all" else kind
            val response = if(mode=="stickers") repository.vaultStickers(submittedQuery,cursor) else if (mode == "basic") {
                repository.vaultMedia(remoteKind, submittedQuery, cursor)
            } else repository.vaultTreasures(remoteKind, submittedQuery, cursor)
            val received = response.vaultItems("items")
            rows = if (cursor.isBlank()) received else rows + received
            nextCursor = response.vaultText("next_cursor")
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (error: Exception) {
            failure = error.message ?: "无法读取文件库。"
            if (cursor.isBlank()) rows = emptyList()
        } finally {
            loading = false
        }
    }

    LaunchedEffect(guideMode) {
        if (guideMode == "basic" || guideMode == "treasures") {
            mode = guideMode
            kind = "all"; query = ""; submittedQuery = ""; rows = emptyList(); revision++
            onGuideModeConsumed()
        }
    }
    LaunchedEffect(mode, kind, submittedQuery, revision) { load() }
    val labels = if(mode=="stickers") emptyList() else if (mode == "basic") basicKinds else treasureKinds
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
        contentPadding = PaddingValues(top = 22.dp, bottom = 24.dp),
        modifier = Modifier.fillMaxSize().clipToBounds().padding(horizontal = 18.dp)
    ) {
        item(key = "controls") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("basic" to "基本文件库", "treasures" to "收藏", "stickers" to "表情包").forEach { (value, title) ->
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
                if(mode=="stickers")TextButton(onClick={chooseSticker.launch(arrayOf("image/png","image/jpeg","image/webp"))},enabled=!uploadBusy){Text("＋ 添加图片")}
                SnowLetterSurface(
                    modifier = Modifier.fillMaxWidth(),
                    role = SnowLetterSurfaceRole.StatusCard,
                    fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                    fallbackShape = RoundedCornerShape(20.dp),
                    fallbackElevation = 1.dp
                ) {
                    Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 18.dp),
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
                    else if(mode=="stickers") "从文件库的图片菜单添加表情包。" else "还没有符合条件的收藏记录。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        if(mode=="stickers") items(visibleRows,key={"sticker-"+it.vaultText("id")}){entry->
            CoastStickerCard(entry,repository,onSnackbar,onChanged={revision++})
        }
        else groupOrder.forEach { name ->
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
    val originalName = if (treasure && kind == "image") item.vaultText("excerpt")
        else item.vaultText("name")
    val displayName = item.vaultText("display_name")
    val heading = when (kind) {
        "audio" -> "已保存语音"
        "soil" -> "原位思维壤"
        "text" -> "文字摘抄"
        else -> (if (kind == "image") displayName.ifBlank { originalName } else originalName)
            .ifBlank { if (kind == "image") "海岸影像" else "海岸附件" }
    }
    var note by remember(id) { mutableStateOf(item.vaultText("notes")) }
    var noteExpanded by remember(id) { mutableStateOf(false) }
    var noteHasMore by remember(id) { mutableStateOf(false) }
    var noteEditing by remember(id) { mutableStateOf(false) }
    var showRename by remember(id) { mutableStateOf(false) }
    var showSticker by remember(id) { mutableStateOf(false) }
    var stickerText by remember(id) { mutableStateOf("") }
    var renameText by remember(id) { mutableStateOf(displayName) }
    LaunchedEffect(item.vaultText("notes")) { if (!noteEditing) note = item.vaultText("notes") }
    LaunchedEffect(displayName) { renameText = displayName }
    var busy by remember(id) { mutableStateOf(false) }
    var showActions by remember(id) { mutableStateOf(false) }
    var showCancel by remember(id) { mutableStateOf(false) }
    var showInfo by remember(id) { mutableStateOf(false) }
    var showText by remember(id) { mutableStateOf(false) }
    var audioExpanded by remember(id) { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
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

    fun saveInlineNote() {
        scope.launch {
            busy = true
            try {
                val favoriteId = if (treasure) id else item.vaultText("treasure_id")
                if (favoriteId.isNotBlank()) {
                    repository.vaultChangeNote(favoriteId, note)
                    onSnackbar("备注已保存。")
                } else {
                    repository.vaultSave(kind, conversation, sourceId, note)
                    onSnackbar("备注已保存，并已收藏。")
                }
                noteEditing = false
                onChanged()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) { onSnackbar("备注保存失败：" + error.message) }
            finally { busy = false }
        }
    }

    fun renameImage() {
        scope.launch {
            busy = true
            try {
                repository.vaultRenameImage(conversation, sourceId, renameText)
                showRename = false
                onChanged()
                onSnackbar("展示名称已保存，原始文件未修改。")
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) { onSnackbar("重命名失败：" + error.message) }
            finally { busy = false }
        }
    }

    fun favorite() {
        if (treasure || item.vaultFlag("favorited")) { showCancel = true; return }
        scope.launch {
            busy = true
            try {
                repository.vaultSave(kind, conversation, sourceId, note)
                onSnackbar("已收藏。")
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
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Box(Modifier.weight(1f)) { CoastVaultAudio(repository, sourceId, onSnackbar) }
                        TextButton(onClick = { audioExpanded = !audioExpanded }) {
                            Text(if (audioExpanded) "收起" else "展开",
                                style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    if (audioExpanded) {
                        if (sourceText.isNotBlank()) {
                            Text("语音原文", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            SelectionContainer {
                                Text(sourceText, style = MaterialTheme.typography.bodyMedium)
                            }
                        } else {
                            Text("此条语音暂无可读取的原文。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            val actions = listOf("下载语音", "回到来源", "复制全文") +
                                (if (treasure || item.vaultFlag("favorited")) listOf("取消珍藏") else emptyList())
                            actions.forEach { action ->
                                TextButton(
                                    enabled = !busy && (action != "复制全文" || sourceText.isNotBlank()),
                                    onClick = {
                                        when (action) {
                                            "下载语音" -> download()
                                            "回到来源" -> openSource()
                                            "复制全文" -> {
                                                clipboard.setText(AnnotatedString(sourceText))
                                                onSnackbar("已复制语音原文。")
                                            }
                                            "取消珍藏" -> showCancel = true
                                        }
                                    },
                                    modifier = Modifier.weight(1f).background(
                                        MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
                                ) {
                                    Text(action, style = MaterialTheme.typography.labelSmall,
                                        maxLines = 1, textAlign = TextAlign.Center)
                                }
                            }
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
                                onNote = { noteEditing = true; if (kind == "image") imageOpen = null; if (kind == "audio") audioExpanded = true }, onRead = { showText = true },
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
                                onNote = { noteEditing = true; if (kind == "image") imageOpen = null; if (kind == "audio") audioExpanded = true }, onRead = { showText = true },
                                hasMedia = false, hasText = sourceText.isNotBlank())
                        }
                    }
                }
            }
            if (noteEditing && (kind != "audio" || audioExpanded)) {
                OutlinedTextField(
                    value = note, onValueChange = { note = it.take(1200) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2, maxLines = 4,
                    textStyle = MaterialTheme.typography.bodySmall,
                    placeholder = { Text("写一点想留下的话…") }
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(enabled = !busy, onClick = ::saveInlineNote) {
                        Text(if (treasure || item.vaultFlag("favorited")) "保存备注"
                            else "收藏并保存", style = MaterialTheme.typography.labelSmall)
                    }
                    TextButton(onClick = {
                        note = item.vaultText("notes")
                        noteEditing = false
                    }) { Text("取消", style = MaterialTheme.typography.labelSmall) }
                }
            } else if (note.isNotBlank()) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    Column(Modifier.weight(1f).clickable { if (noteHasMore) noteExpanded = !noteExpanded }) {
                        Text(note, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = if (noteExpanded) Int.MAX_VALUE else 2,
                            overflow = TextOverflow.Ellipsis,
                            onTextLayout = { if (!noteExpanded) noteHasMore = it.hasVisualOverflow })
                        if (noteHasMore) Text(if (noteExpanded) "收起⌃" else "展开⌄",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { noteEditing = true; if (kind == "audio") audioExpanded = true }) {
                        Text("修改", style = MaterialTheme.typography.labelSmall)
                    }
                }
            } else if (kind != "audio" || audioExpanded) {
                TextButton(onClick = { noteEditing = true; if (kind == "audio") audioExpanded = true }) {
                    Text("添加备注…", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        onNote = { noteEditing = true; if (kind == "image") imageOpen = null; if (kind == "audio") audioExpanded = true }, onRead = { showText = true },
                        hasMedia = true, hasText = false, onRename = { showRename = true }, onSticker={showSticker=true;imageOpen=null})
                }
            }
            Image(imageOpen!!.asImageBitmap(), contentDescription = "海岸影像原图",
                modifier = Modifier.fillMaxWidth().heightIn(max = 540.dp),
                contentScale = ContentScale.Fit)
            Text(heading, style = MaterialTheme.typography.bodyMedium)
            Text("原文件名：" + originalName, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if(showSticker) AlertDialog(
        onDismissRequest={if(!busy)showSticker=false},title={Text("加入表情包")},
        text={Column(verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text("写一句供模型选择时参考的说明。原图保留。",style=MaterialTheme.typography.bodySmall)
            OutlinedTextField(stickerText,{stickerText=it.take(500)},label={Text("素材说明")})
        }},
        confirmButton={TextButton(enabled=!busy&&stickerText.isNotBlank(),onClick={scope.launch{
            busy=true
            try{repository.vaultRegisterSticker(conversation,sourceId,stickerText);showSticker=false;stickerText="";onSnackbar("已登记表情包。")}
            catch(c:CancellationException){throw c}catch(e:Exception){onSnackbar("登记失败："+e.message)}finally{busy=false}
        }}){Text("保存")}},
        dismissButton={TextButton(enabled=!busy,onClick={showSticker=false}){Text("取消")}}
    )
    if (showRename) AlertDialog(
        onDismissRequest = { if (!busy) showRename = false },
        title = { Text("修改图片展示名称") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("原始文件不会改变。留空会恢复原文件名。",
                    style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = renameText, onValueChange = { renameText = it.take(80) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    placeholder = { Text("图片展示名称") }
                )
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = ::renameImage) { Text("保存名称") }
        },
        dismissButton = { TextButton(onClick = { showRename = false }) { Text("取消") } }
    )
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
            SelectionContainer {
                Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                    Text(sourceText, style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(sourceText))
                onSnackbar("已复制全文。")
            }) { Text("复制全文") }
        },
        dismissButton = { TextButton(onClick = { showText = false }) { Text("收起") } }
    )
    if (showCancel) AlertDialog(
        onDismissRequest = { showCancel = false },
        title = { Text("取消这条珍藏？") },
        text = { Text("只移除收藏里的收藏，原聊天和媒体不会删除。") },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                showCancel = false
                scope.launch {
                    busy = true
                    try {
                        repository.vaultRemove(if (treasure) id else item.vaultText("treasure_id"))
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
    hasText: Boolean,
    onRename: (() -> Unit)? = null,
    onSticker: (() -> Unit)? = null
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if(onSticker!=null)DropdownMenuItem(text={Text("加入表情包")},enabled=!busy,onClick={onDismiss();onSticker()})
        if (onRename != null) DropdownMenuItem(
            text = { Text("修改名称") },
            enabled = !busy,
            onClick = { onDismiss(); onRename() }
        )
        DropdownMenuItem(
            text = { Text(if (treasure || alreadySaved) "取消珍藏" else "收藏") },
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


@Composable
private fun CoastStickerCard(item:JsonObject,repository:SideRoomsRepository,onSnackbar:(String)->Unit,onChanged:()->Unit){
    val id=item.vaultText("id");val scope=rememberCoroutineScope()
    var desc by remember(id,item.vaultText("description")){mutableStateOf(item.vaultText("description"))}
    var busy by remember(id){mutableStateOf(false)}
    var remove by remember(id){mutableStateOf(false)}
    var preview by remember(id){mutableStateOf<Bitmap?>(null)}
    fun change(action:suspend ()->Unit){scope.launch{
        busy=true
        try{action();remove=false;onChanged()}catch(c:CancellationException){throw c}catch(e:Exception){onSnackbar("素材操作失败："+e.message)}finally{busy=false}
    }}
    SnowLetterSurface(modifier=Modifier.fillMaxWidth(),role=SnowLetterSurfaceRole.StatusCard,fallbackColor=MaterialTheme.colorScheme.surface,fallbackShape=RoundedCornerShape(18.dp)){
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically){
                Box(Modifier.weight(1f)){
                    if(item.vaultFlag("available"))CoastVaultImage(repository,item.vaultText("attachment_id"),item.vaultText("conversation_id"),onSnackbar){preview=it}
                    else Text("原件不可访问")
                }
                Column(Modifier.weight(2f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                    Text(if(item.vaultText("author")=="assistant")"模型添加" else "屋主添加",style=MaterialTheme.typography.labelSmall)
                    Text(if(item.vaultFlag("enabled"))"已启用" else "已停用",style=MaterialTheme.typography.labelMedium)
                    OutlinedTextField(desc,{desc=it.take(500)},enabled=!busy,label={Text("素材说明")},modifier=Modifier.fillMaxWidth())
                }
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly){
                TextButton(enabled=!busy&&desc.isNotBlank(),onClick={change{repository.vaultUpdateSticker(id,description=desc)}}){Text("保存说明")}
                TextButton(enabled=!busy,onClick={change{repository.vaultUpdateSticker(id,enabled=!item.vaultFlag("enabled"))}}){Text(if(item.vaultFlag("enabled"))"停用" else "启用")}
                TextButton(enabled=!busy,onClick={remove=true}){Text("移除")}
            }
        }
    }
    if(remove)AlertDialog(onDismissRequest={if(!busy)remove=false},title={Text("移除表情包？")},text={Text("只移除素材索引，保留原图及已经发送的聊天。")},confirmButton={TextButton(enabled=!busy,onClick={change{repository.vaultRemoveSticker(id)}}){Text("移除")}},dismissButton={TextButton(onClick={remove=false},enabled=!busy){Text("取消")}})
    preview?.let{image->Dialog(onDismissRequest={preview=null}){Image(image.asImageBitmap(),contentDescription="表情包原图",modifier=Modifier.fillMaxWidth().clickable{preview=null},contentScale=ContentScale.Fit)}}
}
