package com.elementeracoast.app.feature.memory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
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
import com.elementeracoast.app.feature.daily.DailyField
import com.elementeracoast.app.feature.daily.DailyPrimaryButton
import com.elementeracoast.app.feature.daily.DailySurfaceCard
import com.elementeracoast.app.feature.wolf.ChoiceRow
import com.elementeracoast.app.feature.wolf.WolfTextField
import kotlinx.coroutines.launch

@Composable
internal fun WorldbookScreen(
    repository: MemoryRepository,
    createRequested: Boolean,
    onCreateConsumed: () -> Unit,
    onSnackbar: (String) -> Unit
) {
    val state by repository.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    var testText by remember { mutableStateOf("") }
    var testResult by remember { mutableStateOf<List<WorldbookEntry>>(emptyList()) }
    var editing by remember { mutableStateOf<WorldbookEntry?>(null) }
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(createRequested) {
        if (createRequested) {
            creating = true
            onCreateConsumed()
        }
    }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            DailySurfaceCard {
                DailyField("试一句", testText, { testText = it }, "聊到哪个海岸名词，就试哪个")
                Spacer(Modifier.height(14.dp))
                DailyPrimaryButton("测试命中") {
                    scope.launch {
                        runCatching { repository.testWorldbook(testText) }
                            .onSuccess {
                                testResult = it
                                onSnackbar(if (it.isEmpty()) "没有命中启用词条" else "命中 ${it.size} 条")
                            }
                            .onFailure { onSnackbar(it.message ?: "世界书测试失败") }
                    }
                }
                if (testResult.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    testResult.forEach { Text("✓ ${it.title}", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        item {
            Text("世界书", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.worldbook.isEmpty()) {
            item {
                DailySurfaceCard {
                    Text("海岸世界书目前还是空的。以后聊到某个专有名词时，再整理进来。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            items(state.worldbook, key = { it.id }) { entry ->
                DailySurfaceCard {
                    Text(entry.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(if (entry.enabled) "已启用" else "已停用", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                    if (entry.keywords.isNotEmpty()) Text("关键词：${entry.keywords.joinToString(" · ")}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(6.dp))
                    Text(entry.content)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        Text(if (entry.enabled) "停用" else "启用", modifier = Modifier.clickable {
                            scope.launch {
                                runCatching { repository.saveWorldbook(entry.copy(enabled = !entry.enabled)) }
                                    .onSuccess { onSnackbar(if (entry.enabled) "词条已停用" else "词条已启用") }
                                    .onFailure { onSnackbar(it.message ?: "世界书状态更新失败") }
                            }
                        }, color = MaterialTheme.colorScheme.primary)
                        Text("编辑", modifier = Modifier.clickable { editing = entry }, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    if (creating) WorldbookEditor(null, { creating = false }) { draft ->
        scope.launch {
            runCatching { repository.saveWorldbook(draft) }
                .onSuccess { creating = false; onSnackbar("世界书词条已写入海岸") }
                .onFailure { onSnackbar(it.message ?: "保存世界书失败") }
        }
    }
    editing?.let { entry ->
        WorldbookEditor(entry, { editing = null }) { draft ->
            scope.launch {
                runCatching { repository.saveWorldbook(draft.copy(id = entry.id)) }
                    .onSuccess { editing = null; onSnackbar("世界书词条已更新") }
                    .onFailure { onSnackbar(it.message ?: "更新世界书失败") }
            }
        }
    }
}

@Composable
private fun WorldbookEditor(entry: WorldbookEntry?, onDismiss: () -> Unit, onSave: (WorldbookEntry) -> Unit) {
    var title by remember(entry?.id) { mutableStateOf(entry?.title ?: "") }
    var content by remember(entry?.id) { mutableStateOf(entry?.content ?: "") }
    var keywords by remember(entry?.id) { mutableStateOf(entry?.keywords?.joinToString(", ") ?: "") }
    var enabled by remember(entry?.id) { mutableStateOf(entry?.enabled ?: true) }
    var constantActive by remember(entry?.id) { mutableStateOf(entry?.constantActive ?: false) }
    var caseSensitive by remember(entry?.id) { mutableStateOf(entry?.caseSensitive ?: false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (entry == null) "新增世界书" else "编辑世界书") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                WolfTextField("标题", title, { title = it })
                WolfTextField("内容", content, { content = it }, minLines = 3)
                WolfTextField("关键词（逗号分隔）", keywords, { keywords = it })
                ChoiceRow(if (enabled) "已启用" else "已停用", enabled) { enabled = !enabled }
                ChoiceRow("常驻激活", constantActive) { constantActive = !constantActive }
                ChoiceRow("区分大小写", caseSensitive) { caseSensitive = !caseSensitive }
            }
        },
        confirmButton = {
            TextButton(enabled = title.isNotBlank() && content.isNotBlank(), onClick = {
                onSave(
                    WorldbookEntry(
                        id = entry?.id.orEmpty(),
                        title = title,
                        content = content,
                        keywords = keywords.split(',').map(String::trim).filter(String::isNotBlank).distinct(),
                        useRegex = entry?.useRegex ?: false,
                        caseSensitive = caseSensitive,
                        constantActive = constantActive,
                        priority = entry?.priority ?: 0,
                        scanDepth = entry?.scanDepth ?: 4,
                        enabled = enabled,
                        scope = entry?.scope ?: "owner",
                        visitorSafe = entry?.visitorSafe ?: false
                    )
                )
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
