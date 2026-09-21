package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.feature.wolf.WolfTextField
import java.time.LocalDate
import kotlinx.coroutines.launch

@Composable
internal fun DiaryScreen(
    repository: DailyRepository,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit,
    onCompose: () -> Unit
) {
    val snapshot by repository.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<DailyDiary?>(null) }
    var deleting by remember { mutableStateOf<DailyDiary?>(null) }

    fun reportFailure(label: String, error: Throwable) {
        val detail = if (error is CoastApiException) error.message else error.message ?: "未知错误"
        onSnackbar("$label：$detail")
    }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 34.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (snapshot.diaries.isEmpty()) {
            item {
                DailySurfaceCard(onClick = onCompose) {
                    Text("还没有日记。", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    Text("想写的时候再留一张纸。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                }
            }
        } else {
            items(snapshot.diaries, key = { it.id }) { entry ->
                DailySurfaceCard {
                    Text(entry.date.replace('-', '/'), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.height(7.dp))
                    Text(entry.text, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${entry.weather} · ${entry.mood}${if (entry.tags.isEmpty()) "" else " · ${entry.tags.joinToString(" / ")}"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (entry.displayAuthor.isNotBlank() && entry.displayAuthor != "屋主") {
                        Spacer(Modifier.height(5.dp))
                        Text(entry.displayAuthor, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = { editing = entry }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Outlined.Edit, contentDescription = "编辑日记", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                        }
                        IconButton(onClick = { deleting = entry }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Outlined.DeleteOutline, contentDescription = "删除日记", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }

    editing?.let { entry ->
        DiaryEditor(entry, onDismiss = { editing = null }) { draft ->
            if (draft.text.isBlank()) onSnackbar("正文还是空的") else scope.launch {
                try {
                    repository.patchDiary(entry.id, draft.date, draft.weather, draft.mood, draft.tags, draft.text)
                    onActionLogged("daily.diary.edit", "编辑了一篇日记", "海岸更新 1 篇日记")
                    onSnackbar("日记已写回海岸")
                    editing = null
                } catch (error: Throwable) { reportFailure("日记更新失败", error) }
            }
        }
    }
    deleting?.let { entry ->
        DailyDeleteConfirmDialog(
            title = "删除这篇日记？",
            body = "这是海岸里的正式纸页；删除后 PWA 与 Native 都不会再看到它。",
            onDismiss = { deleting = null },
            onConfirm = {
                scope.launch {
                    try {
                        repository.deleteDiary(entry.id)
                        onActionLogged("daily.diary.delete", "删除了一篇日记", "海岸删除 1 篇日记")
                        onSnackbar("日记已从海岸删除")
                        deleting = null
                    } catch (error: Throwable) { reportFailure("日记删除失败", error) }
                }
            }
        )
    }
}

@Composable
internal fun DiaryComposeScreen(
    repository: DailyRepository,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit,
    onDone: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var date by remember { mutableStateOf(LocalDate.now().toString().replace('-', '/')) }
    var weather by remember { mutableStateOf("") }
    var mood by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(horizontal = 28.dp, vertical = 34.dp)) {
        item {
            DailySurfaceCard {
                DailyField("日期", date, { date = it }, "YYYY/MM/DD")
                Spacer(Modifier.height(18.dp))
                DailyField("天气", weather, { weather = it }, "未标注")
                Spacer(Modifier.height(18.dp))
                DailyField("心情", mood, { mood = it }, "未标注")
                Spacer(Modifier.height(18.dp))
                DailyField("正文", body, { body = it }, "写今天。", minLines = 12, maxLines = 20)
                Spacer(Modifier.height(18.dp))
                DailyField("标签（逗号或换行分隔）", tags, { tags = it }, minLines = 3, maxLines = 6)
                Spacer(Modifier.height(18.dp))
                DailyPrimaryButton(if (saving) "正在写回海岸…" else "写入日记") {
                    if (body.isBlank()) {
                        onSnackbar("正文还是空的")
                    } else if (!saving) {
                        saving = true
                        scope.launch {
                            try {
                                repository.createDiary(date, weather, mood, splitTags(tags), body)
                                onActionLogged("daily.diary.write", "写了一篇日记", "海岸新增 1 篇屋主日记")
                                onSnackbar("日记已留在海岸")
                                onDone()
                            } catch (error: Throwable) {
                                val detail = if (error is CoastApiException) error.message else error.message ?: "未知错误"
                                onSnackbar("日记写入失败：$detail")
                            } finally { saving = false }
                        }
                    }
                }
            }
        }
    }
}

private data class DiaryDraft(
    val date: String,
    val weather: String,
    val mood: String,
    val tags: List<String>,
    val text: String
)

@Composable
private fun DiaryEditor(entry: DailyDiary, onDismiss: () -> Unit, onSave: (DiaryDraft) -> Unit) {
    var date by remember(entry.id) { mutableStateOf(entry.date) }
    var weather by remember(entry.id) { mutableStateOf(entry.weather) }
    var mood by remember(entry.id) { mutableStateOf(entry.mood) }
    var tags by remember(entry.id) { mutableStateOf(entry.tags.joinToString(", ")) }
    var text by remember(entry.id) { mutableStateOf(entry.text) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑日记") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                WolfTextField("日期", date, { date = it })
                WolfTextField("天气", weather, { weather = it })
                WolfTextField("心情", mood, { mood = it })
                WolfTextField("正文", text, { text = it }, minLines = 5)
                WolfTextField("标签", tags, { tags = it })
            }
        },
        confirmButton = { TextButton(onClick = { onSave(DiaryDraft(date, weather, mood, splitTags(tags), text)) }) { Text("保存") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

private fun splitTags(raw: String): List<String> = raw
    .split(',', '\n')
    .map(String::trim)
    .filter(String::isNotBlank)
    .distinct()
