package com.elementeracoast.app.feature.memory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.feature.daily.DailySurfaceCard
import com.elementeracoast.app.feature.wolf.ChoiceRow
import com.elementeracoast.app.feature.wolf.WolfTextField
import java.time.LocalDate
import kotlinx.coroutines.launch

@Composable
internal fun MemoryLibraryScreen(
    repository: MemoryRepository,
    createRequested: Boolean,
    onCreateConsumed: () -> Unit,
    onOpenPending: () -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit
) {
    val state by repository.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var filterKind by remember { mutableStateOf(MemoryFilterKind.Tag) }
    var filterValue by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<MemoryEntry?>(null) }
    var creating by remember { mutableStateOf(false) }
    var expandedId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(createRequested) {
        if (createRequested) {
            creating = true
            onCreateConsumed()
        }
    }

    val filterValues = when (filterKind) {
        MemoryFilterKind.Tag -> (canonicalMemoryTags + state.memories.flatMap { it.tags } + state.memories.map { it.tag })
            .filter(String::isNotBlank).distinct()
        MemoryFilterKind.Date -> state.memories.map { it.sourceDate }.filter(String::isNotBlank).distinct().sortedDescending()
        MemoryFilterKind.Model -> state.memories.map { it.sourceModel }.filter(String::isNotBlank).distinct().sorted()
        MemoryFilterKind.Window -> state.memories.map { it.sourceWindow }.filter(String::isNotBlank).distinct().sorted()
    }
    val needle = query.trim().lowercase()
    val visible = state.memories.filter { entry ->
        val searchHit = needle.isBlank() || listOf(entry.title, entry.lifeCore, entry.content, entry.usageHint, entry.avoidHint)
            .any { it.lowercase().contains(needle) }
        val filterHit = filterValue.isBlank() || when (filterKind) {
            MemoryFilterKind.Tag -> filterValue == entry.tag || filterValue in entry.tags
            MemoryFilterKind.Date -> entry.sourceDate == filterValue
            MemoryFilterKind.Model -> entry.sourceModel == filterValue
            MemoryFilterKind.Window -> entry.sourceWindow == filterValue
        }
        searchHit && filterHit
    }

    LazyColumn(
        contentPadding = PaddingValues(top = 2.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            MemoryRetrievalCard(
                query = query,
                onQueryChange = { query = it },
                filterKind = filterKind,
                onFilterKindChange = { filterKind = it },
                filterValue = filterValue,
                values = filterValues,
                onFilterValueChange = { filterValue = it }
            )
        }
        item { MemoryPendingCard(state.pockets.size, onOpenPending) }
        item {
            Text(
                "记忆库",
                modifier = Modifier.padding(start = 36.dp, end = 36.dp, top = 8.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
        }
        if (visible.isEmpty()) {
            item {
                Column(Modifier.padding(horizontal = 28.dp)) {
                    DailySurfaceCard {
                        Text(
                            if (state.memories.isEmpty()) "还没有长期记忆。" else "没有匹配的记忆。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                }
            }
        } else {
            items(visible, key = { it.id }) { entry ->
                Column(Modifier.padding(horizontal = 28.dp)) {
                    DailySurfaceCard(onClick = { expandedId = if (expandedId == entry.id) null else entry.id }) {
                        Text(entry.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        if (entry.lifeCore.isNotBlank()) {
                            Spacer(Modifier.height(3.dp))
                            Text(entry.lifeCore, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                        }
                        val meta = (entry.tags + entry.tag).filter(String::isNotBlank).distinct().joinToString(" · ")
                        if (meta.isNotBlank()) Text(meta, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        if (expandedId == entry.id) {
                            Spacer(Modifier.height(12.dp))
                            if (entry.content.isNotBlank()) Text(entry.content, style = MaterialTheme.typography.bodyMedium)
                            if (entry.usageHint.isNotBlank()) Text("使用时机：${entry.usageHint}", style = MaterialTheme.typography.bodySmall)
                            if (entry.avoidHint.isNotBlank()) Text("勿误用：${entry.avoidHint}", style = MaterialTheme.typography.bodySmall)
                            Text("保护级别：${entry.memoryLevel}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            Text(
                                "索引：${entry.sourceModel.ifBlank { "—" }} / ${entry.sourceWindow.ifBlank { "—" }} / ${entry.sourceDate.ifBlank { "—" }}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall
                            )
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                                Text("编辑", modifier = Modifier.clickable { editing = entry }, color = MaterialTheme.colorScheme.primary)
                                Text("删除", modifier = Modifier.clickable {
                                    scope.launch {
                                        runCatching { repository.deleteEntry(entry.id) }
                                            .onSuccess {
                                                onActionLogged("memory.delete", "删除记忆", "删除 1 条 canonical 记忆")
                                                onSnackbar("记忆已删除")
                                            }
                                            .onFailure { onSnackbar(it.message ?: "删除记忆失败") }
                                    }
                                }, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating) MemoryEditor(null, onDismiss = { creating = false }) { draft ->
        scope.launch {
            runCatching { repository.saveEntry(draft) }
                .onSuccess {
                    creating = false
                    onActionLogged("memory.write", "写入记忆", "新增 1 条 canonical 记忆")
                    onSnackbar("记忆已写入")
                }
                .onFailure { onSnackbar(it.message ?: "保存记忆失败") }
        }
    }
    editing?.let { entry ->
        MemoryEditor(entry, onDismiss = { editing = null }) { draft ->
            scope.launch {
                runCatching { repository.saveEntry(draft.copy(id = entry.id)) }
                    .onSuccess {
                        editing = null
                        onActionLogged("memory.edit", "编辑记忆", "更新 1 条 canonical 记忆")
                        onSnackbar("记忆已更新")
                    }
                    .onFailure { onSnackbar(it.message ?: "更新记忆失败") }
            }
        }
    }
}

@Composable
private fun MemoryEditor(entry: MemoryEntry?, onDismiss: () -> Unit, onSave: (MemoryEntry) -> Unit) {
    var title by remember(entry?.id) { mutableStateOf(entry?.title ?: "") }
    var lifeCore by remember(entry?.id) { mutableStateOf(entry?.lifeCore ?: "") }
    var content by remember(entry?.id) { mutableStateOf(entry?.content ?: "") }
    var usageHint by remember(entry?.id) { mutableStateOf(entry?.usageHint ?: "") }
    var avoidHint by remember(entry?.id) { mutableStateOf(entry?.avoidHint ?: "") }
    var tag by remember(entry?.id) { mutableStateOf(entry?.tag ?: entry?.tags?.firstOrNull().orEmpty()) }
    var memoryLevel by remember(entry?.id) { mutableStateOf(entry?.memoryLevel ?: "ordinary") }
    var sourceModel by remember(entry?.id) { mutableStateOf(entry?.sourceModel ?: "手动整理") }
    var sourceWindow by remember(entry?.id) { mutableStateOf(entry?.sourceWindow ?: "Native") }
    var sourceDate by remember(entry?.id) { mutableStateOf(entry?.sourceDate ?: LocalDate.now().toString()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (entry == null) "新增记忆" else "编辑记忆") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                WolfTextField("标题", title, { title = it })
                WolfTextField("生命核", lifeCore, { lifeCore = it })
                WolfTextField("内容", content, { content = it }, minLines = 3)
                WolfTextField("使用时机", usageHint, { usageHint = it })
                WolfTextField("勿误用", avoidHint, { avoidHint = it })
                Text("正式标签", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                canonicalMemoryTags.forEach { candidate -> ChoiceRow(candidate, tag == candidate) { tag = candidate } }
                Text("保护级别", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                ChoiceRow("ordinary", memoryLevel == "ordinary") { memoryLevel = "ordinary" }
                ChoiceRow("core", memoryLevel == "core") { memoryLevel = "core" }
                WolfTextField("模型", sourceModel, { sourceModel = it })
                WolfTextField("窗口", sourceWindow, { sourceWindow = it })
                WolfTextField("日期", sourceDate, { sourceDate = it })
            }
        },
        confirmButton = {
            TextButton(
                enabled = title.isNotBlank() && lifeCore.isNotBlank(),
                onClick = {
                    onSave(
                        MemoryEntry(
                            id = entry?.id.orEmpty(),
                            entryType = "memory",
                            title = title,
                            lifeCore = lifeCore,
                            content = content,
                            usageHint = usageHint,
                            avoidHint = avoidHint,
                            memoryLevel = memoryLevel,
                            status = entry?.status ?: "active",
                            tags = if (tag.isBlank()) emptyList() else listOf(tag),
                            tag = tag,
                            sourceModel = sourceModel,
                            sourceWindow = sourceWindow,
                            sourceDate = sourceDate
                        )
                    )
                }
            ) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
