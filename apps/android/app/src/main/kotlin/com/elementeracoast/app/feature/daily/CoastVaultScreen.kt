package com.elementeracoast.app.feature.daily

import android.graphics.BitmapFactory
import android.media.MediaPlayer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import java.io.File

private fun JsonObject.vaultText(name: String): String =
    this[name]?.jsonPrimitive?.contentOrNull.orEmpty()

private fun JsonObject.vaultFlag(name: String): Boolean =
    this[name]?.jsonPrimitive?.booleanOrNull == true

private fun JsonObject.vaultItems(name: String): List<JsonObject> =
    (this[name] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

private val vaultBasicKinds = listOf("all" to "全部", "image" to "影像", "audio" to "声音", "file" to "文件")
private val vaultTreasureKinds = listOf("all" to "全部", "text" to "文字", "image" to "影像",
    "audio" to "声音", "file" to "其他")

/**
 * Native face of the shared server catalog. It does not keep a second local
 * media database: all notes and favorites are written to the Coast backend.
 */
@Composable
fun CoastVaultScreen(repository: SideRoomsRepository, onSnackbar: (String) -> Unit) {
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
            val response = if (mode == "basic") {
                repository.vaultMedia(kind, submittedQuery, cursor)
            } else repository.vaultTreasures(kind, submittedQuery, cursor)
            val received = response.vaultItems("items")
            rows = if (cursor.isBlank()) received else rows + received
            nextCursor = response.vaultText("next_cursor")
        } catch (error: Exception) {
            failure = error.message ?: "无法读取海岸文件库。"
            if (cursor.isBlank()) rows = emptyList()
        } finally {
            loading = false
        }
    }

    LaunchedEffect(mode, kind, submittedQuery, revision) { load() }
    val kinds = if (mode == "basic") vaultBasicKinds else vaultTreasureKinds

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.padding(horizontal = 16.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("basic" to "基本文件库", "treasures" to "拾潮 · 珍藏").forEach { (value, title) ->
                    TextButton(onClick = {
                        mode = value
                        kind = "all"
                        query = ""
                        submittedQuery = ""
                    }) {
                        Text(
                            title,
                            fontWeight = if (mode == value) FontWeight.Bold else FontWeight.Normal,
                            color = if (mode == value) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            Text(
                if (mode == "basic") "已保存的图片、语音和附件自动归集；普通聊天文字不在这里。"
                else "只留下你主动珍藏的东西，备注也可以搜索。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            OutlinedTextField(
                value = query, onValueChange = { query = it.take(100) },
                modifier = Modifier.fillMaxWidth(), singleLine = true,
                placeholder = { Text("搜索文件名、语音正文或收藏备注") }
            )
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                kinds.forEach { (value, name) ->
                    TextButton(onClick = { kind = value }) {
                        Text(name, color = if (kind == value) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Button(onClick = { submittedQuery = query; revision++ }) { Text("搜索") }
            if (failure.isNotBlank()) Text(
                "读取失败：" + failure,
                color = MaterialTheme.colorScheme.error
            )
            if (loading) Text("正在寻找海岸里的记录…")
            if (!loading && rows.isEmpty() && failure.isBlank()) {
                Text(if (mode == "basic") "这里还没有可读取的历史媒体。"
                     else "这里暂时没有符合条件的主动珍藏。")
            }
        }
        items(rows, key = { it.vaultText("id") }) { item ->
            CoastVaultCard(item, mode == "treasures", repository, onSnackbar) { revision++ }
        }
        if (nextCursor.isNotBlank()) item {
            TextButton(
                enabled = !loading,
                onClick = { scope.launch { load(nextCursor) } }
            ) { Text("继续查看") }
        }
        item {
            Text("文件和语音由海岸服务器提供。取消红心不删除媒体；原件已经失效的记录不能重新生成。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 20.dp))
        }
    }
}

@Composable
private fun CoastVaultCard(
    item: JsonObject,
    treasure: Boolean,
    repository: SideRoomsRepository,
    onSnackbar: (String) -> Unit,
    onChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val kind = item.vaultText("kind")
    val id = item.vaultText("id")
    val sourceId = if (treasure) item.vaultText("source_id") else id
    val conversation = item.vaultText("conversation_id")
    var note by remember(id) { mutableStateOf(item.vaultText("notes")) }
    var busy by remember(id) { mutableStateOf(false) }
    var showCancel by remember(id) { mutableStateOf(false) }
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
                val filename = if (kind == "audio") "coast-voice-" + sourceId + ".mp3"
                    else (item.vaultText("name").ifBlank { "海岸附件" })
                saveLauncher.launch(filename)
            } catch (error: Exception) { onSnackbar("下载失败：" + error.message) }
        }
    }

    Card(shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp)
        ) {
            val heading = if (treasure) {
                if (kind == "text") "文字摘录" else "珍藏 · " + kind
            } else item.vaultText("name").ifBlank { "海岸媒体" }
            Text(heading, fontWeight = FontWeight.Bold)
            if (kind == "image") CoastVaultImage(repository, sourceId, conversation, onSnackbar)
            if (kind == "audio") CoastVaultAudio(repository, sourceId, onSnackbar)
            val excerpt = if (treasure) item.vaultText("excerpt") else item.vaultText("source_text")
            if (excerpt.isNotBlank()) {
                Text(excerpt.take(800), style = MaterialTheme.typography.bodyMedium)
            }
            if (kind != "text") Text(
                "来源窗口：" + conversation.take(24),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            OutlinedTextField(
                value = note, onValueChange = { note = it.take(1200) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("备注") }
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (treasure) {
                    TextButton(enabled = !busy, onClick = {
                        scope.launch {
                            busy = true
                            try {
                                repository.vaultChangeNote(id, note)
                                onSnackbar("备注已保存。")
                            } catch (error: Exception) { onSnackbar("无法保存备注：" + error.message) }
                            finally { busy = false }
                        }
                    }) { Text("保存备注") }
                    TextButton(enabled = !busy, onClick = { showCancel = true }) { Text("取消珍藏") }
                } else if (item.vaultFlag("favorited")) {
                    TextButton(enabled = !busy, onClick = {
                        val favoriteId = item.vaultText("treasure_id")
                        if (favoriteId.isNotBlank()) {
                            scope.launch {
                                busy = true
                                try {
                                    repository.vaultRemove(favoriteId)
                                    onChanged()
                                    onSnackbar("已取消珍藏，原媒体还在。")
                                } catch (error: Exception) { onSnackbar("操作失败：" + error.message) }
                                finally { busy = false }
                            }
                        }
                    }) { Text("♥ 取消珍藏") }
                } else {
                    TextButton(enabled = !busy, onClick = {
                        scope.launch {
                            busy = true
                            try {
                                repository.vaultSave(kind, conversation, sourceId, note)
                                onChanged()
                                onSnackbar("已拾入潮间。")
                            } catch (error: Exception) { onSnackbar("无法收藏：" + error.message) }
                            finally { busy = false }
                        }
                    }) { Text("♡ 拾入潮间") }
                }
                if (kind == "image" || kind == "file" || kind == "audio") {
                    TextButton(enabled = !busy, onClick = ::download) { Text("保存文件") }
                }
            }
        }
    }
    if (showCancel) AlertDialog(
        onDismissRequest = { showCancel = false },
        title = { Text("取消这条珍藏？") },
        text = { Text("只移除拾潮的收藏记录，不删除聊天或原媒体。") },
        confirmButton = {
            TextButton(onClick = {
                showCancel = false
                scope.launch {
                    busy = true
                    try {
                        repository.vaultRemove(id)
                        onChanged()
                        onSnackbar("已取消珍藏。")
                    } catch (error: Exception) { onSnackbar("操作失败：" + error.message) }
                    finally { busy = false }
                }
            }) { Text("取消珍藏") }
        },
        dismissButton = { TextButton(onClick = { showCancel = false }) { Text("保留") } }
    )
}

@Composable
private fun CoastVaultImage(
    repository: SideRoomsRepository,
    id: String,
    conversation: String,
    onSnackbar: (String) -> Unit
) {
    var bitmap by remember(id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(id, conversation) {
        try {
            val bytes = repository.vaultAttachment(id, conversation)
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (error: Exception) {
            onSnackbar("图片暂时无法预览：" + error.message)
        }
    }
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = "保存的海岸图片",
            modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp),
            contentScale = ContentScale.Fit
        )
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
    DisposableEffect(id) {
        onDispose {
            player?.release()
            file?.delete()
        }
    }
    TextButton(onClick = {
        scope.launch {
            try {
                if (playing) {
                    player?.pause()
                    playing = false
                } else if (player != null) {
                    player?.start()
                    playing = true
                } else {
                    val bytes = repository.audio(id)
                    val local = File.createTempFile("coast-vault-", ".mp3", context.cacheDir)
                    local.writeBytes(bytes)
                    file = local
                    val next = MediaPlayer()
                    next.setDataSource(local.absolutePath)
                    next.prepare()
                    next.setOnCompletionListener { playing = false }
                    player = next
                    next.start()
                    playing = true
                }
            } catch (error: Exception) { onSnackbar("语音播放失败：" + error.message) }
        }
    }) { Text(if (playing) "暂停语音" else "播放已生成语音") }
}
