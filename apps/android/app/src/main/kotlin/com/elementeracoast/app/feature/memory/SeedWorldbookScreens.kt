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
internal fun SeedLibraryScreen(
    repository: MemoryRepository,
    createRequested: Boolean,
    onCreateConsumed: () -> Unit,
    onOpenPending: () -> Unit,
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
        MemoryFilterKind.Tag -> (canonicalMemoryTags + state.seeds.flatMap { it.tags } + state.seeds.map { it.tag })
            .filter(String::isNotBlank).distinct()
        MemoryFilterKind.Date -> state.seeds.map { it.sourceDate }.filter(String::isNotBlank).distinct().sortedDescending()
        MemoryFilterKind.Model -> state.seeds.map { it.sourceModel }.filter(String::isNotBlank).distinct().sorted()
        MemoryFilterKind.Window -> state.seeds.map { it.sourceWindow }.filter(String::isNotBlank).distinct().sorted()
    }
    val needle = query.trim().lowercase()
    val visible = state.seeds.filter { seed ->
        val searchHit = needle.isBlank() || listOf(seed.title, seed.lifeCore, seed.content, seed.usageHint, seed.avoidHint)
            .any { it.lowercase().contains(needle) }
        val filterHit = filterValue.isBlank() || when (filterKind) {
            MemoryFilterKind.Tag -> filterValue == seed.tag || filterValue in seed.tags
            MemoryFilterKind.Date -> seed.sourceDate == filterValue
            MemoryFilterKind.Model -> seed.sourceModel == filterValue
            MemoryFilterKind.Window -> seed.sourceWindow == filterValue
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
                "种子库",
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
                        Text(if (state.seeds.isEmpty()) "还没有种子。" else "没有匹配的种子。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        } else {
            items(visible, key = { it.id }) { seed ->
                Column(Modifier.padding(horizontal = 28.dp)) {
                    DailySurfaceCard(onClick = { expandedId = if (expandedId == seed.id) null else seed.id }) {
                        Text(seed.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(seed.status, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                        if (seed.lifeCore.isNotBlank()) Text(seed.lifeCore, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                        val meta = (seed.tags + seed.tag).filter(String::isNotBlank).distinct().joinToString(" · ")
                        if (meta.isNotBlank()) Text(meta, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        if (expandedId == seed.id) {
                            Spacer(Modifier.height(8.dp))
                            if (seed.content.isNotBlank()) Text(seed.content, style = MaterialTheme.typography.bodyMedium)
                            if (seed.usageHint.isNotBlank()) Text("使用时机：${seed.usageHint}", style = MaterialTheme.typography.bodySmall)
                            if (seed.avoidHint.isNotBlank()) Text("勿误用：${seed.avoidHint}", style = MaterialTheme.typography.bodySmall)
                            Text("索引：${seed.sourceModel.ifBlank { "—" }} / ${seed.sourceWindow.ifBlank { "—" }} / ${seed.sourceDate.ifBlank { "—" }}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                                Text("编辑", modifier = Modifier.clickable { editing = seed }, color = MaterialTheme.colorScheme.primary)
                                Text("删除", modifier = Modifier.clickable {
                                    scope.launch {
                                        runCatching { repository.deleteEntry(seed.id) }
                                            .onSuccess { onSnackbar("种子已删除") }
                                            .onFailure { onSnackbar(it.message ?: "删除种子失败") }
                                    }
                                }, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating) SeedEditor(null, { creating = false }) { draft ->
        scope.launch {
            runCatching { repository.saveEntry(draft) }
                .onSuccess { creating = false; onSnackbar("种子已写入") }
                .onFailure { onSnackbar(it.message ?: "保存种子失败") }
        }
    }
    editing?.let { seed ->
        SeedEditor(seed, { editing = null }) { draft ->
            scope.launch {
                runCatching { repository.saveEntry(draft.copy(id = seed.id)) }
                    .onSuccess { editing = null; onSnackbar("种子已更新") }
                    .onFailure { onSnackbar(it.message ?: "更新种子失败") }
            }
        }
    }
}

@Composable
private fun SeedEditor(seed: MemoryEntry?, onDismiss: () -> Unit, onSave: (MemoryEntry) -> Unit) {
    var title by remember(seed?.id) { mutableStateOf(seed?.title ?: "") }
    var lifeCore by remember(seed?.id) { mutableStateOf(seed?.lifeCore ?: "") }
    var content by remember(seed?.id) { mutableStateOf(seed?.content ?: "") }
    var usageHint by remember(seed?.id) { mutableStateOf(seed?.usageHint ?: "") }
    var avoidHint by remember(seed?.id) { mutableStateOf(seed?.avoidHint ?: "") }
    var status by remember(seed?.id) { mutableStateOf(seed?.status ?: "dormant") }
    var tag by remember(seed?.id) { mutableStateOf(seed?.tag ?: seed?.tags?.firstOrNull().orEmpty()) }
    var sourceModel by remember(seed?.id) { mutableStateOf(seed?.sourceModel ?: "手动整理") }
    var sourceWindow by remember(seed?.id) { mutableStateOf(seed?.sourceWindow ?: "Native") }
    var sourceDate by remember(seed?.id) { mutableStateOf(seed?.sourceDate ?: LocalDate.now().toString()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (seed == null) "新增种子" else "编辑种子") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                WolfTextField("标题", title, { title = it })
                WolfTextField("生命核", lifeCore, { lifeCore = it })
                WolfTextField("内容", content, { content = it }, minLines = 3)
                WolfTextField("使用时机", usageHint, { usageHint = it })
                WolfTextField("勿误用", avoidHint, { avoidHint = it })
                Text("状态", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                ChoiceRow("dormant", status == "dormant") { status = "dormant" }
                ChoiceRow("active", status == "active") { status = "active" }
                Text("正式标签", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                canonicalMemoryTags.forEach { candidate -> ChoiceRow(candidate, tag == candidate) { tag = candidate } }
                WolfTextField("模型", sourceModel, { sourceModel = it })
                WolfTextField("窗口", sourceWindow, { sourceWindow = it })
                WolfTextField("日期", sourceDate, { sourceDate = it })
            }
        },
        confirmButton = {
            TextButton(enabled = title.isNotBlank() && lifeCore.isNotBlank(), onClick = {
                onSave(
                    MemoryEntry(
                        id = seed?.id.orEmpty(),
                        entryType = "seed",
                        title = title,
                        lifeCore = lifeCore,
                        content = content,
                        usageHint = usageHint,
                        avoidHint = avoidHint,
                        memoryLevel = "ordinary",
                        status = status,
                        tags = if (tag.isBlank()) emptyList() else listOf(tag),
                        tag = tag,
                        sourceModel = sourceModel,
                        sourceWindow = sourceWindow,
                        sourceDate = sourceDate
                    )
                )
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
