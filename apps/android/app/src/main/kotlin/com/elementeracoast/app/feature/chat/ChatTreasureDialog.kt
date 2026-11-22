package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.feature.daily.SideRoomsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

internal data class TreasureChoice(
    val kind: String, val sourceId: String, val title: String,
    val paragraphs: List<String> = emptyList()
) {
    val key: String get() = kind + ":" + sourceId
}

internal fun messageTreasureChoices(message: ChatMessage, voiceClips: List<VoiceClip>): List<TreasureChoice> = buildList {
    val variantId = message.remoteVariantId.orEmpty()
    if (variantId.isBlank()) return@buildList
    if (message.text.isNotBlank()) {
        add(TreasureChoice("text", variantId,
            if (message.role == MessageRole.User) "我的文字" else "助手的文字",
            message.text.split(Regex("\\n\\s*\\n"))))
    }
    message.attachments.forEach { item ->
        if (item.id.isNotBlank()) add(TreasureChoice(
            if (item.type == "image") "image" else "file",
            item.id,
            item.name.ifBlank { "聊天附件" }
        ))
    }
    if (message.role == MessageRole.Assistant) voiceClips.forEach { item ->
        if (item.id.isNotBlank()) add(TreasureChoice("audio", item.id,
            "已生成语音 · " + item.text.take(80)))
    }
}

private fun JsonObject.vText(key: String): String =
    this[key]?.jsonPrimitive?.contentOrNull.orEmpty()

private fun JsonObject.vIndices(): Set<Int> =
    (this["paragraph_indices"] as? JsonArray).orEmpty()
        .mapNotNull { it.jsonPrimitive.intOrNull }.toSet()

@Composable
internal fun ChatTreasureDialog(
    conversationId: String,
    message: ChatMessage,
    voiceClips: List<VoiceClip>,
    repository: SideRoomsRepository,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
    onNotice: (String) -> Unit
) {
    val turnId = message.turnId.orEmpty()
    val choices = remember(message.remoteVariantId, message.text, message.attachments, voiceClips) {
        messageTreasureChoices(message, voiceClips)
    }
    val keys = remember(choices) { choices.map { it.key }.toSet() }
    var saved by remember(message.remoteVariantId) { mutableStateOf<Map<String, JsonObject>>(emptyMap()) }
    var selected by remember(message.remoteVariantId) { mutableStateOf<Set<String>>(emptySet()) }
    var paragraphs by remember(message.remoteVariantId) { mutableStateOf<Set<Int>>(emptySet()) }
    var notes by remember(message.remoteVariantId) { mutableStateOf("") }
    var loading by remember(message.remoteVariantId) { mutableStateOf(true) }
    var writing by remember(message.remoteVariantId) { mutableStateOf(false) }
    var error by remember(message.remoteVariantId) { mutableStateOf("") }
    var confirmClear by remember(message.remoteVariantId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val textChoice = choices.firstOrNull { it.kind == "text" }

    LaunchedEffect(conversationId, message.remoteVariantId, turnId) {
        if (conversationId.isBlank() || turnId.isBlank()) {
            error = "找不到原消息的持久来源。"
            loading = false
            return@LaunchedEffect
        }
        loading = true
        try {
            val rows = mutableListOf<JsonObject>()
            var cursor = ""
            repeat(6) {
                val page = repository.vaultTreasures(conversationId = conversationId,
                    turnId = turnId, cursor = cursor)
                rows.addAll((page["items"] as? JsonArray).orEmpty()
                    .mapNotNull { it as? JsonObject })
                cursor = page["next_cursor"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (cursor.isBlank()) return@repeat
            }
            if (cursor.isNotBlank()) throw IllegalStateException("收藏数量超出当前查看上限。")
            val related = rows.filter { it.vText("kind") + ":" + it.vText("source_id") in keys }
            saved = related.associateBy { it.vText("kind") + ":" + it.vText("source_id") }
            selected = if (related.isEmpty()) keys else saved.keys
            val total = textChoice?.paragraphs?.size ?: 0
            val storedIndices = saved[textChoice?.key]?.vIndices().orEmpty()
            paragraphs = if (storedIndices.isEmpty()) (0 until total).toSet() else storedIndices
            notes = related.firstOrNull { it.vText("notes").isNotBlank() }?.vText("notes").orEmpty()
            error = ""
        } catch (cancel: CancellationException) { throw cancel }
        catch (failure: Exception) { error = "读取珍藏失败：" + failure.message }
        finally { loading = false }
    }

    suspend fun saveChanges() {
        writing = true
        try {
            for (choice in choices) {
                val old = saved[choice.key]
                if (choice.key !in selected) {
                    if (old != null) repository.vaultRemove(old.vText("id"))
                } else {
                    val selectedParagraphs = if (choice.kind == "text" && choice.paragraphs.size > 1)
                        paragraphs.sorted() else emptyList()
                    if (choice.kind == "text" && choice.paragraphs.size > 1 && selectedParagraphs.isEmpty()) {
                        error = "请至少选中一个文字段落。"
                        return
                    }
                    repository.vaultSave(choice.kind, conversationId, choice.sourceId, notes.trim(),
                        selectedParagraphs.takeIf { it.isNotEmpty() &&
                            it.size < choice.paragraphs.size })
                }
            }
            onSaved()
        } catch (cancel: CancellationException) { throw cancel }
        catch (failure: Exception) {
            error = "有操作可能已保存，请重新打开核对：" + (failure.message ?: "请求失败")
        } finally { writing = false }
    }

    AlertDialog(
        onDismissRequest = { if (!writing) onDismiss() },
        title = { Text("拾入潮间") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                Text("图片、语音和附件原本就在基本文件库；红心只代表主动珍藏。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (loading) Text("正在读取这条消息的收藏状态…")
                if (!loading && choices.isEmpty()) Text("没有可珍藏的正文或媒体。")
                if (!loading && error.isBlank() || !loading && saved.isNotEmpty()) choices.forEach { choice ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = choice.key in selected,
                            enabled = !writing,
                            onCheckedChange = { checked ->
                                selected = if (checked) selected + choice.key else selected - choice.key
                            }
                        )
                        Text(choice.title.take(160), modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium)
                    }
                    if (choice.kind == "text" && choice.key in selected && choice.paragraphs.size > 1) {
                        choice.paragraphs.forEachIndexed { index, item ->
                            Row(
                                modifier = Modifier.padding(start = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(
                                    checked = index in paragraphs,
                                    enabled = !writing,
                                    onCheckedChange = { checked ->
                                        paragraphs = if (checked) paragraphs + index else paragraphs - index
                                    }
                                )
                                Text(item.take(150), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                if (!loading && choices.isNotEmpty()) {
                    OutlinedTextField(
                        value = notes, onValueChange = { notes = it.take(1200) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !writing, maxLines = 3,
                        label = { Text("备注（可按关键词搜索）") }
                    )
                }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !loading && !writing && choices.isNotEmpty() && error.isBlank(),
                onClick = {
                    if (selected.isEmpty() && saved.isEmpty()) {
                        error = "请至少选择一项。"
                    } else if (selected.isEmpty()) {
                        confirmClear = true
                    } else {
                        scope.launch { saveChanges() }
                    }
                }
            ) { Text(if (writing) "正在保存…" else "保存选择") }
        },
        dismissButton = { TextButton(enabled = !writing, onClick = onDismiss) { Text("返回") } }
    )
    if (confirmClear) AlertDialog(
        onDismissRequest = { confirmClear = false },
        title = { Text("取消这条消息的全部珍藏？") },
        text = { Text("只取消拾潮里的红心，原聊天、图片、语音和文件仍在。") },
        confirmButton = { TextButton(onClick = {
            confirmClear = false
            scope.launch { saveChanges() }
        }) { Text("取消珍藏") } },
        dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("保留") } }
    )
}
