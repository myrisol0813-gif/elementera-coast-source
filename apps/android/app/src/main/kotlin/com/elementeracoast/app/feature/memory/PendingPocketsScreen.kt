package com.elementeracoast.app.feature.memory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import kotlinx.coroutines.launch

@Composable
internal fun PendingPocketsScreen(
    repository: MemoryRepository,
    onSnackbar: (String) -> Unit
) {
    val state by repository.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    var resolving by remember { mutableStateOf<Pair<MemoryPocket, String>?>(null) }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (state.pockets.isEmpty()) {
            item {
                DailySurfaceCard {
                    Text("当前窗口的待确认区是空的。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            items(state.pockets, key = { it.id }) { pocket ->
                DailySurfaceCard {
                    Text(pocket.title.ifBlank { "未命名候选" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    if (pocket.lifeCore.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(pocket.lifeCore, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (pocket.content.isNotBlank() && pocket.content != pocket.lifeCore) {
                        Spacer(Modifier.height(8.dp))
                        Text(pocket.content, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (pocket.sourceExcerpt.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text("来源：${pocket.sourceExcerpt}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("确认到记忆", modifier = Modifier.clickable { resolving = pocket to "memory" }, color = MaterialTheme.colorScheme.primary)
                        Text("确认到种子", modifier = Modifier.clickable { resolving = pocket to "seed" }, color = MaterialTheme.colorScheme.primary)
                        Text("丢弃", modifier = Modifier.clickable {
                            scope.launch {
                                runCatching { repository.resolvePocket(pocket.id, "discard") }
                                    .onSuccess { onSnackbar("已从待确认区丢弃") }
                                    .onFailure { onSnackbar(it.message ?: "待确认区操作失败") }
                            }
                        }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    resolving?.let { (pocket, action) ->
        PocketResolveDialog(
            action = action,
            pocket = pocket,
            onDismiss = { resolving = null },
            onResolve = { tag ->
                scope.launch {
                    runCatching { repository.resolvePocket(pocket.id, action, tag) }
                        .onSuccess {
                            resolving = null
                            onSnackbar(if (action == "memory") "已确认到记忆库" else "已确认到种子库")
                        }
                        .onFailure { onSnackbar(it.message ?: "待确认区确认失败") }
                }
            }
        )
    }
}

@Composable
private fun PocketResolveDialog(
    action: String,
    pocket: MemoryPocket,
    onDismiss: () -> Unit,
    onResolve: (String) -> Unit
) {
    var tag by remember(pocket.id, action) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (action == "memory") "确认到记忆库" else "确认到种子库") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(pocket.title, fontWeight = FontWeight.SemiBold)
                Text("选择一个海岸正式标签：", color = MaterialTheme.colorScheme.onSurfaceVariant)
                canonicalMemoryTags.forEach { candidate ->
                    ChoiceRow(candidate, tag == candidate) { tag = candidate }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = tag.isNotBlank(), onClick = { onResolve(tag) }) { Text("确认") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
