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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.LocalDate
import java.time.YearMonth

private fun JsonObject.value(name: String): String = this[name]?.jsonPrimitive?.contentOrNull.orEmpty()
private fun JsonObject.kind(): String = value("kind")
private fun JsonObject.day(): String = value("occurrence_day")

@Composable
fun CalendarScreen(repository: SideRoomsRepository, onSnackbar: (String) -> Unit) {
    var month by remember { mutableStateOf(YearMonth.now()) }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var entries by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var overview by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf("all") }
    var loadError by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var formOpen by remember { mutableStateOf(false) }
    var revision by remember { androidx.compose.runtime.mutableIntStateOf(0) }

    suspend fun refresh() {
        busy = true
        loadError = false
        try {
            val rows = (if (overview) repository.allCalendar() else repository.calendar(month.toString()))["entries"]?.jsonArray.orEmpty()
            entries = rows.mapNotNull { it as? JsonObject }
        } catch (error: kotlinx.coroutines.CancellationException) { throw error
        } catch (error: Exception) {
            loadError = true
            onSnackbar("日历读取失败：${error.message}")
        } finally { busy = false }
    }
    LaunchedEffect(month, overview, revision) { refresh() }
    fun entryType(item: JsonObject) = if (item["anniversary"] is JsonObject) "anniversary" else if (item.kind() == "note") "note" else "event"
    val visible = if (overview) entries.filter { filter == "all" || entryType(it) == filter } else entries.filter { it.day() == day.toString() }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { overview = !overview; entries = emptyList(); loadError = false }) { Text(if (overview) "返回月历" else "全部记录") }
            if (overview) Text("共 ${entries.size} 条", modifier = Modifier.padding(top = 10.dp))
        }
        if (overview) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                listOf("all" to "全部", "anniversary" to "纪念日", "event" to "日程", "note" to "随记").forEach { (key, label) ->
                    TextButton(onClick = { filter = key }) { Text(label, fontWeight = if (filter == key) FontWeight.Bold else FontWeight.Normal) }
                }
            }
        } else {
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
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (busy) item { Text("正在同步日历…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (loadError) item { TextButton(onClick = { revision++ }) { Text("读取失败，重试") } }
            if (visible.isEmpty() && !busy && !loadError) item { Text(if (overview) "这里还没有记录。" else "这一天还没有记录。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(if (overview && busy) emptyList() else visible, key = { it.value("id") }) { item ->
                DailySurfaceCard(onClick = { editing = item; formOpen = true }) {
                    Text(item.value("title"), fontWeight = FontWeight.SemiBold)
                    if (overview) Text((item["anniversary"] as? JsonObject)?.value("startDay") ?: item.value("day"), style = MaterialTheme.typography.labelSmall)
                    Text("${if (item["anniversary"] is JsonObject) "纪念日" else if (item.kind() == "note") "随记" else "日程"} · ${if (item.value("author") == "owner") "屋主" else "模型伙伴"}" +
                        (if (item.value("recurrence") == "yearly") " · 每年重复" else "") +
                        (if (item["anniversary"] is JsonObject) { if ((item["anniversary"] as JsonObject)["pinned"]?.toString() == "true") " · 侧栏展示" else " · 未置顶" } else ""),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.value("body").isNotEmpty()) Text(item.value("body"), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
    if (formOpen) CalendarEntryEditor(repository, editing, day,
        onDismiss = { formOpen = false },
        onChanged = { saved ->
            formOpen = false
            saved?.calendarText("day")?.let { value ->
                day = LocalDate.parse(value); month = YearMonth.from(day)
            }
            revision++
        }, onSnackbar = onSnackbar)
}
