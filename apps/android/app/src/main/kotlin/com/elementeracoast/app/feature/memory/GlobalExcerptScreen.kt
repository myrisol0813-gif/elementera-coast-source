package com.elementeracoast.app.feature.memory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.launch

private data class PortraitDiffPreview(
    val proposed: AnnotatedString,
    val removedText: String
)

@Composable
fun UserPortraitScreen(
    repository: MemoryRepository,
    onSnackbar: (String) -> Unit
) {
    val snapshot by repository.snapshot.collectAsState()
    PortraitScreen(
        document = snapshot.userPortrait,
        title = "用户画像",
        refresh = repository::refreshUserPortrait,
        setAutoOrganize = repository::setUserPortraitWriteEnabled,
        clear = repository::clearUserPortrait,
        confirm = repository::confirmUserPortraitCandidate,
        discard = repository::discardUserPortraitCandidate,
        onSnackbar = onSnackbar
    )
}

@Composable
fun GlobalExcerptScreen(
    repository: MemoryRepository,
    onSnackbar: (String) -> Unit
) {
    val snapshot by repository.snapshot.collectAsState()
    PortraitScreen(
        document = snapshot.globalExcerpt,
        title = "自我画像",
        refresh = repository::refreshGlobalExcerpt,
        setAutoOrganize = repository::setGlobalExcerptWriteEnabled,
        clear = repository::clearGlobalExcerpt,
        confirm = repository::confirmGlobalExcerptCandidate,
        discard = repository::discardGlobalExcerptCandidate,
        onSnackbar = onSnackbar
    )
}

@Composable
private fun PortraitScreen(
    document: GlobalExcerpt,
    title: String,
    refresh: suspend () -> Unit,
    setAutoOrganize: suspend (Boolean) -> Unit,
    clear: suspend (Int) -> Unit,
    confirm: suspend (String, String?) -> Unit,
    discard: suspend (String) -> Unit,
    onSnackbar: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var guidanceOpen by remember(title) { mutableStateOf(false) }
    var historyOpen by remember(title) { mutableStateOf(false) }
    var expandedRevisionIds by remember(title) { mutableStateOf(emptySet<String>()) }
    var editingCandidateId by remember(title) { mutableStateOf<String?>(null) }
    var editBody by remember(title) { mutableStateOf("") }
    var busyId by remember(title) { mutableStateOf<String?>(null) }
    var clearConfirmation by remember(title) { mutableStateOf(false) }

    LaunchedEffect(title) {
        runCatching { refresh() }
            .onFailure { onSnackbar("$title 读取失败：${it.message ?: "未知错误"}") }
    }

    fun runAction(id: String = "portrait", success: String, block: suspend () -> Unit) {
        if (busyId != null) return
        busyId = id
        scope.launch {
            runCatching { block() }
                .onSuccess { onSnackbar(success) }
                .onFailure { onSnackbar("$title 操作失败：${it.message ?: "未知错误"}") }
            busyId = null
        }
    }

    if (clearConfirmation) {
        AlertDialog(
            onDismissRequest = { if (busyId == null) clearConfirmation = false },
            title = { Text("清空$title 正文？") },
            text = { Text("正式正文会变为空白；已有修改历史仍保留，待确认修改不会删除。") },
            confirmButton = {
                Button(
                    enabled = busyId == null,
                    onClick = {
                        val version = document.revision
                        runAction("clear", "$title 正文已清空，历史仍可查看。") {
                            clear(version)
                            clearConfirmation = false
                        }
                    }
                ) { Text("确认清空") }
            },
            dismissButton = {
                TextButton(
                    enabled = busyId == null,
                    onClick = { clearConfirmation = false }
                ) { Text("保留正文") }
            },
            shape = RoundedCornerShape(24.dp)
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(20.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 17.dp, vertical = 15.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { guidanceOpen = !guidanceOpen },
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("书写时的目光", fontWeight = FontWeight.SemiBold)
                            Text(
                                "这段文字会长久参与未来的认识。",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Text(if (guidanceOpen) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (guidanceOpen) {
                        Spacer(Modifier.height(10.dp))
                        Text(document.writeGuidance, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        item {
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(20.dp)
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 17.dp, vertical = 13.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("自动整理", fontWeight = FontWeight.SemiBold)
                        Text(
                            if (document.writeEnabled) "开启 · 思维壤可在形成新认识时提出修改候选"
                            else "关闭 · 正式正文仍会照常参与上下文",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Switch(
                        checked = document.writeEnabled,
                        enabled = busyId == null,
                        onCheckedChange = { enabled ->
                            runAction(success = if (enabled) "$title 自动整理已开启。" else "$title 停止自动整理。") {
                                setAutoOrganize(enabled)
                            }
                        }
                    )
                }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
            ) {
                Text("正式正文", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (document.body.isNotBlank()) {
                    TextButton(enabled = busyId == null, onClick = { clearConfirmation = true }) {
                        Text("清空正文", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surface,
                fallbackShape = RoundedCornerShape(20.dp)
            ) {
                Text(
                    document.body.ifBlank { "这幅画像还没有开始书写。" },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 18.dp),
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }

        if (document.candidates.isNotEmpty()) {
            item {
                Text("待确认修改 · ${document.candidates.size}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "完整正文预览会标出本次变化；确认后才会成为新的正式画像。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            items(document.candidates, key = { it.id }) { candidate ->
                val diff = diffPreview(
                    document.body,
                    candidate.proposedBody,
                    MaterialTheme.colorScheme.primary.copy(alpha = .16f)
                )
                SnowLetterSurface(
                    modifier = Modifier.fillMaxWidth(),
                    role = SnowLetterSurfaceRole.StatusCard,
                    fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                    fallbackShape = RoundedCornerShape(20.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(candidate.reason.ifBlank { "这一轮形成了新的认识。" }, fontWeight = FontWeight.SemiBold)
                        val source = listOfNotNull(
                            candidate.sourceModel.takeIf(String::isNotBlank),
                            candidate.sourceConversationId?.takeIf(String::isNotBlank),
                            candidate.createdAt?.takeIf(String::isNotBlank)
                        ).joinToString(" · ")
                        if (source.isNotBlank()) {
                            Text(source, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                        }
                        Spacer(Modifier.height(10.dp))
                        Text("候选完整正文", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.height(5.dp))
                        Text(diff.proposed, style = MaterialTheme.typography.bodyMedium)
                        if (diff.removedText.isNotBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text("本次删除 / 被替换部分", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
                            Text(diff.removedText, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(Modifier.height(12.dp))
                        if (editingCandidateId == candidate.id) {
                            OutlinedTextField(
                                value = editBody,
                                onValueChange = { editBody = it },
                                modifier = Modifier.fillMaxWidth(),
                                minLines = 10,
                                label = { Text("编辑完整正文后确认") }
                            )
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    enabled = busyId == null && editBody.isNotBlank(),
                                    onClick = {
                                        runAction(candidate.id, "编辑后的$title 已确认。") {
                                            confirm(candidate.id, editBody)
                                            editingCandidateId = null
                                        }
                                    }
                                ) { Text("编辑后确认") }
                                TextButton(onClick = { editingCandidateId = null }) { Text("取消编辑") }
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Button(
                                    enabled = busyId == null,
                                    onClick = {
                                        runAction(candidate.id, "$title 已确认更新。") {
                                            confirm(candidate.id, null)
                                        }
                                    }
                                ) { Text("确认") }
                                TextButton(onClick = {
                                    editingCandidateId = candidate.id
                                    editBody = candidate.proposedBody
                                }) { Text("编辑后确认") }
                                TextButton(
                                    enabled = busyId == null,
                                    onClick = {
                                        runAction(candidate.id, "这条候选已经放下，正式正文没有改变。") {
                                            discard(candidate.id)
                                        }
                                    }
                                ) { Text("驳回") }
                            }
                        }
                    }
                }
            }
        }

        item {
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(20.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 17.dp, vertical = 15.dp)) {
                    Row(
                        Modifier.fillMaxWidth().clickable { historyOpen = !historyOpen },
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("修改记录 · ${document.revisions.size}", fontWeight = FontWeight.SemiBold)
                            Text("只记录已经确认进入正式正文的变化。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        Text(if (historyOpen) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (historyOpen) {
                        Spacer(Modifier.height(8.dp))
                        if (document.revisions.isEmpty()) {
                            Text("还没有正式修改记录。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            document.revisions.forEach { revision ->
                                val open = revision.id in expandedRevisionIds
                                Column(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            expandedRevisionIds = if (open) expandedRevisionIds - revision.id else expandedRevisionIds + revision.id
                                        }
                                        .padding(vertical = 8.dp)
                                ) {
                                    Text(
                                        "revision ${revision.revision} · ${revision.createdAt.orEmpty().replace('T', ' ').take(16)}",
                                        fontWeight = FontWeight.SemiBold,
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                    Text(
                                        listOf(
                                            revision.confirmationMode.ifBlank { "confirm" },
                                            revision.operator.ifBlank { "user" },
                                            revision.sourceConversationId.orEmpty()
                                        ).filter(String::isNotBlank).joinToString(" · "),
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        style = MaterialTheme.typography.labelSmall
                                    )
                                    if (open) {
                                        if (revision.modelReason.isNotBlank()) {
                                            Spacer(Modifier.height(5.dp))
                                            Text("模型理由：${revision.modelReason}", style = MaterialTheme.typography.bodySmall)
                                        }
                                        Spacer(Modifier.height(5.dp))
                                        Text("修改前", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                                        Text(revision.beforeBody, style = MaterialTheme.typography.bodySmall)
                                        Spacer(Modifier.height(5.dp))
                                        Text("修改后", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                                        Text(revision.afterBody, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        item { Spacer(Modifier.height(18.dp)) }
    }
}

private fun diffPreview(before: String, after: String, tint: androidx.compose.ui.graphics.Color): PortraitDiffPreview {
    if (before == after) return PortraitDiffPreview(AnnotatedString(after), "")
    val maxPrefix = minOf(before.length, after.length)
    var prefix = 0
    while (prefix < maxPrefix && before[prefix] == after[prefix]) prefix += 1

    val maxSuffix = minOf(before.length - prefix, after.length - prefix)
    var suffix = 0
    while (
        suffix < maxSuffix &&
        before[before.length - 1 - suffix] == after[after.length - 1 - suffix]
    ) suffix += 1

    val changedAfterEnd = after.length - suffix
    val changedBeforeEnd = before.length - suffix
    val annotated = buildAnnotatedString {
        append(after.substring(0, prefix))
        if (changedAfterEnd > prefix) {
            withStyle(SpanStyle(background = tint)) {
                append(after.substring(prefix, changedAfterEnd))
            }
        }
        if (suffix > 0) append(after.substring(changedAfterEnd))
    }
    val removed = if (changedBeforeEnd > prefix) before.substring(prefix, changedBeforeEnd).trim() else ""
    return PortraitDiffPreview(annotated, removed)
}
