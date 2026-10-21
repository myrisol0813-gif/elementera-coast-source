package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.YearMonth

private fun JsonObject.value(name: String): String = this[name]?.jsonPrimitive?.contentOrNull.orEmpty()
private fun JsonObject.kind(): String = value("kind")
private fun JsonObject.day(): String = value("occurrence_day")
private fun inputDate(day: LocalDate): String = day.toString()

@Composable
fun CalendarScreen(repository: SideRoomsRepository, onSnackbar: (String) -> Unit) {
    var month by remember { mutableStateOf(YearMonth.now()) }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var entries by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var formOpen by remember { mutableStateOf(false) }
    var deleteCandidate by remember { mutableStateOf<JsonObject?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        busy = true
        try {
            val rows = repository.calendar(month.toString())["entries"]?.jsonArray.orEmpty()
            entries = rows.mapNotNull { it as? JsonObject }
        } catch (error: Exception) {
            onSnackbar("日历读取失败：${error.message}")
        } finally { busy = false }
    }
    LaunchedEffect(month) { refresh() }
    val visible = entries.filter { it.day() == day.toString() }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = {
                val candidate = month.minusMonths(1)
                if (candidate.year >= 1900) { month = candidate; day = candidate.atDay(1) }
            }) { Text("‹ 上月") }
            Text("${month.year} 年 ${month.monthValue} 月", style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 10.dp))
            TextButton(onClick = {
                val candidate = month.plusMonths(1)
                if (candidate.year <= 2200) { month = candidate; day = candidate.atDay(1) }
            }) { Text("下月 ›") }
        }
        val first = month.atDay(1).dayOfWeek.value % 7
        val weeks = (first + month.lengthOfMonth() + 6) / 7
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("日","一","二","三","四","五","六").forEach { Text(it, modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelSmall) }
        }
        repeat(weeks) { week ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                repeat(7) { wd ->
                    val number = week * 7 + wd - first + 1
                    val current = if (number in 1..month.lengthOfMonth()) month.atDay(number) else null
                    val selected = current == day
                    val count = entries.count { it.day() == current?.toString() }
                    androidx.compose.foundation.layout.Box(
                        modifier = Modifier.weight(1f).padding(2.dp)
                            .then(if (selected) Modifier else Modifier)
                            .clickable(enabled = current != null) { if (current != null) day = current }
                            .padding(vertical = 10.dp),
                        contentAlignment = androidx.compose.ui.Alignment.Center
                    ) {
                        Text(
                            text = if (current == null) "" else "$number${if (count > 0) " •" else ""}",
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
        Spacer(Modifier.padding(9.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(day.toString(), style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { editing = null; formOpen = true }) { Text("＋ 记录") }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (busy) item { Text("正在同步海岸日历…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (visible.isEmpty() && !busy) item { Text("这一天还没有记录。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(visible, key = { it.value("id") }) { item ->
                DailySurfaceCard(onClick = { editing = item; formOpen = true }) {
                    Text(item.value("title"), fontWeight = FontWeight.SemiBold)
                    Text("${if (item.kind() == "note") "随记" else "日程"} · ${if (item.value("author") == "owner") "屋主" else "Myri"}" +
                        if (item.value("recurrence") == "yearly") " · 每年重复" else "",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.value("body").isNotEmpty()) Text(item.value("body"), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
    if (formOpen) {
        val existing = editing
        var date by remember(existing) { mutableStateOf(existing?.value("day") ?: inputDate(day)) }
        var title by remember(existing) { mutableStateOf(existing?.value("title").orEmpty()) }
        var body by remember(existing) { mutableStateOf(existing?.value("body").orEmpty()) }
        var kind by remember(existing) { mutableStateOf(existing?.kind() ?: "event") }
        var recurrence by remember(existing) { mutableStateOf(existing?.value("recurrence") ?: "none") }
        AlertDialog(
            onDismissRequest = { formOpen = false },
            title = { Text(if (existing == null) "记下一天" else "修改日历记录") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    DailyField("公历日期 · YYYY-MM-DD", date, { date = it }, maxLines = 1)
                    DailyField("标题 · 最多 120 字", title, { title = it.take(120) })
                    DailyField("内容 · 最多 4000 字", body, { body = it.take(4000) }, minLines = 4, maxLines = 9)
                    TextButton(onClick = { kind = if (kind == "event") "note" else "event" }) {
                        Text("类型：${if (kind == "event") "日程 / 纪念日" else "当天随记"} · 点击切换")
                    }
                    TextButton(onClick = { recurrence = if (recurrence == "none") "yearly" else "none" }) {
                        Text("重复：${if (recurrence == "yearly") "每年" else "不重复"} · 点击切换")
                    }
                    if (existing != null) TextButton(onClick = { deleteCandidate = existing; formOpen = false }) { Text("删除记录") }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val parsed = runCatching { LocalDate.parse(date) }.getOrNull()
                    if (parsed == null || parsed.year !in 1900..2200 || title.isBlank()) {
                        onSnackbar("请填写有效的公历日期和标题。")
                    } else {
                        scope.launch {
                            try {
                                repository.saveCalendar(existing?.value("id"),
                                    buildJsonObject {
                                        put("day", date); put("title", title); put("body", body)
                                        put("kind", kind); put("recurrence", recurrence)
                                    })
                                formOpen = false
                                day = parsed
                                month = YearMonth.from(parsed)
                                refresh()
                                onSnackbar("这页公历记录已经收好。")
                            } catch (error: Exception) { onSnackbar("保存日历失败：${error.message}") }
                        }
                    }
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { formOpen = false }) { Text("取消") } },
            shape = RoundedCornerShape(22.dp)
        )
    }
    deleteCandidate?.let { item ->
        AlertDialog(onDismissRequest = { deleteCandidate = null },
            title = { Text("删除这条日历记录？") },
            text = { Text(item.value("title")) },
            confirmButton = { TextButton(onClick = {
                val id = item.value("id")
                deleteCandidate = null
                scope.launch {
                    try { repository.deleteCalendar(id); refresh() }
                    catch(error: Exception) { onSnackbar("删除失败：${error.message}") }
                }
            }) { Text("确认删除") } },
            dismissButton = { TextButton(onClick = { deleteCandidate = null }) { Text("取消") } }
        )
    }
}
