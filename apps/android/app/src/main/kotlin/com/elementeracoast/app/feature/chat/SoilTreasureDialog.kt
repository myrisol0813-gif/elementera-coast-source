package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.feature.daily.SideRoomsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

internal fun soilTreasureSegments(soil: ThoughtSoilSnapshot): List<String> =
    (listOf(soil.currentText) + soil.afterthoughts)
        .flatMap { it.split(Regex("\\n\\s*\\n")) }
        .map(String::trim).filter(String::isNotEmpty)

@Composable
internal fun SoilTreasureDialog(
    soil: ThoughtSoilSnapshot,
    repository: SideRoomsRepository,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val segments = remember(soil.sourceAssistantMessageId) { soilTreasureSegments(soil) }
    val identity = soil.sourceAssistantMessageId
    val conversationId = soil.conversationId
    val turnId = soil.sourceTurnId
    var loaded by remember(identity) { mutableStateOf(false) }
    var busy by remember(identity) { mutableStateOf(false) }
    var saved by remember(identity) { mutableStateOf<JsonObject?>(null) }
    var notes by remember(identity) { mutableStateOf("") }
    var selected by remember(identity) { mutableStateOf<Set<Int>>(emptySet()) }
    var error by remember(identity) { mutableStateOf("") }
    var showRemovalConfirmation by remember(identity) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(conversationId, turnId, identity) {
        if (conversationId.isBlank() || turnId.isBlank() || identity.isBlank()) {
            error = "找不到这层思维壤的原位消息 ID。"
            loaded = true
            return@LaunchedEffect
        }
        try {
            val result = repository.vaultTreasures(
                kind = "soil", conversationId = conversationId, turnId = turnId
            )
            saved = (result["items"] as? JsonArray).orEmpty()
                .mapNotNull { it as? JsonObject }
                .firstOrNull { it["source_id"]?.jsonPrimitive?.contentOrNull == identity }
            notes = saved?.get("notes")?.jsonPrimitive?.contentOrNull.orEmpty()
            val chosen = (saved?.get("paragraph_indices") as? JsonArray).orEmpty()
                .mapNotNull { it.jsonPrimitive.intOrNull }.toSet()
            selected = if (chosen.isEmpty()) segments.indices.toSet() else chosen
            error = ""
        } catch (cancel: CancellationException) { throw cancel }
        catch (failure: Exception) { error = "读取原位收藏状态失败：" + failure.message }
        finally { loaded = true }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("拾潮 · 旧思维壤") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 470.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                Text("逐段选择旧「当前」和「余思」。原位土层不改动，也不会因此自动进入模型上下文。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!loaded) Text("正在读取原收藏状态…")
                if (loaded && segments.isEmpty()) Text("本层没有可珍藏的文字。")
                if (loaded) segments.forEachIndexed { index, item ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = index in selected,
                            enabled = !busy,
                            onCheckedChange = { checked ->
                                selected = if (checked) selected + index else selected - index
                            }
                        )
                        Text(item.take(450), style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f))
                    }
                }
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it.take(1200) },
                    enabled = loaded && !busy,
                    modifier = Modifier.fillMaxWidth(), maxLines = 3,
                    label = { Text("备注 · 可搜索") }
                )
                if (saved != null) TextButton(
                    enabled = !busy, onClick = { showRemovalConfirmation = true }
                ) { Text("取消这层珍藏") }
                if (error.isNotBlank()) Text(error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                enabled = loaded && !busy && segments.isNotEmpty() && error.isBlank(),
                onClick = {
                    if (selected.isEmpty()) {
                        error = "请至少选中一段文字。"
                    } else if (selected.size < segments.size && selected.size > 40) {
                        error = "最多选中 40 段。"
                    } else {
                        scope.launch {
                            busy = true
                            try {
                                repository.vaultSave(
                                    kind = "soil", conversationId = conversationId,
                                    sourceId = identity, notes = notes.trim(),
                                    paragraphIndices = selected.sorted()
                                        .takeIf { it.size < segments.size }
                                )
                                onSaved()
                            } catch (cancel: CancellationException) { throw cancel }
                            catch (failure: Exception) {
                                error = "珍藏失败：" + (failure.message ?: "请核对原位来源。")
                            } finally { busy = false }
                        }
                    }
                }
            ) { Text(if (busy) "保存中…" else "保存选段") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("返回") } }
    )
    if (showRemovalConfirmation) AlertDialog(
        onDismissRequest = { showRemovalConfirmation = false },
        title = { Text("取消收藏？") },
        text = { Text("只取消拾潮里的这层收藏，原思维壤仍然留在消息旁边。") },
        confirmButton = { TextButton(onClick = {
            showRemovalConfirmation = false
            val id = saved?.get("id")?.jsonPrimitive?.contentOrNull ?: return@TextButton
            scope.launch {
                busy = true
                try {
                    repository.vaultRemove(id)
                    onSaved()
                } catch (failure: Exception) { error = "取消失败：" + failure.message }
                finally { busy = false }
            }
        }) { Text("取消珍藏") } },
        dismissButton = { TextButton(onClick = { showRemovalConfirmation = false }) { Text("保留") } }
    )
}
