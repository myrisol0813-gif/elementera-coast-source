package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.LocalDate

internal fun JsonObject.calendarText(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

@Composable
internal fun CalendarEntryEditor(
    repository: SideRoomsRepository,
    existing: JsonObject?,
    initialDay: LocalDate,
    fromSidebar: Boolean = false,
    onDismiss: () -> Unit,
    onChanged: (JsonObject?) -> Unit,
    onSnackbar: (String) -> Unit
) {
    val ann = existing?.get("anniversary") as? JsonObject
    var date by remember(existing) { mutableStateOf(ann?.calendarText("startDay") ?: existing?.calendarText("day") ?: initialDay.toString()) }
    var title by remember(existing) { mutableStateOf(existing?.calendarText("title").orEmpty()) }
    var body by remember(existing) { mutableStateOf(existing?.calendarText("body").orEmpty()) }
    var kind by remember(existing) { mutableStateOf(if (ann != null || fromSidebar) "anniversary" else existing?.calendarText("kind") ?: "event") }
    var recurrence by remember(existing) { mutableStateOf(existing?.calendarText("recurrence") ?: "none") }
    var mode by remember(existing) { mutableStateOf(ann?.calendarText("mode") ?: "elapsed") }
    var target by remember(existing) { mutableStateOf(ann?.calendarText("targetDays")?.ifBlank { "100" } ?: "100") }
    var pinned by remember(existing) { mutableStateOf(ann?.get("pinned")?.jsonPrimitive?.booleanOrNull ?: fromSidebar) }
    var busy by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val kinds = listOf("event" to "日程", "note" to "随记", "anniversary" to "纪念日")
    val modes = listOf("elapsed" to "累计天数", "milestone" to "第 N 天倒数", "yearly" to "周年倒数")
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (existing == null) "记下一天" else "修改日历记录") },
        text = {
            Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    kinds.forEach { (key, name) -> FilterChip(selected = kind == key, onClick = { kind = key }, label = { Text(name) }) }
                }
                DailyField(if (kind == "anniversary") "起始日期 · YYYY-MM-DD" else "公历日期 · YYYY-MM-DD", date, { date = it }, maxLines = 1)
                DailyField("标题 · 最多 120 字", title, { title = it.take(120) })
                if (kind == "anniversary") {
                    Text("计算方式", style = MaterialTheme.typography.labelMedium)
                    modes.forEach { (key, name) ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = mode == key, onClick = { mode = key })
                            TextButton(onClick = { mode = key }) { Text(name) }
                        }
                    }
                    if (mode == "milestone") DailyField("目标天数 · 1—109938", target, { target = it.take(6) }, maxLines = 1)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = pinned, onCheckedChange = { pinned = it })
                        Text("在侧栏展示")
                    }
                    Text("起始日为第 1 天；取消侧栏展示不会删除日历记录。2 月 29 日仅在闰年重复。",
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    TextButton(onClick = { recurrence = if (recurrence == "none") "yearly" else "none" }) {
                        Text(if (recurrence == "yearly") "每年重复" else "不重复")
                    }
                }
                DailyField("内容 · 最多 4000 字", body, { body = it.take(4000) }, minLines = 2, maxLines = 5)
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                if (existing != null) TextButton(enabled = !busy, onClick = { deleting = true }) { Text("删除记录") }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                val parsed = runCatching { LocalDate.parse(date) }.getOrNull()
                if (parsed == null || parsed.year !in 1900..2200 || title.isBlank()) {
                    error = "请填写有效的公历日期和标题。"
                } else {
                    val anniversary = if (kind == "anniversary") runCatching {
                        CalendarAnniversary(parsed, mode, if (mode == "milestone") target.toInt() else null, pinned)
                    }.getOrNull() else null
                    if (kind == "anniversary" && anniversary == null) {
                        error = "纪念日日期或目标天数无效。"
                    } else {
                        busy = true; error = ""
                        scope.launch {
                            try {
                                val result = repository.saveCalendar(existing?.calendarText("id"), buildJsonObject {
                                    put("day", date); put("title", title); put("body", body)
                                    put("kind", if (anniversary == null) kind else "event")
                                    put("recurrence", anniversary?.recurrence ?: recurrence)
                                    put("anniversary", if (anniversary == null) JsonNull else buildJsonObject {
                                        put("startDay", date); put("mode", mode)
                                        put("targetDays", anniversary.targetDays?.let(::JsonPrimitive) ?: JsonNull)
                                        put("pinned", pinned)
                                    })
                                })
                                val saved = result["entry"]?.jsonObject ?: error("日历没有确认保存")
                                onChanged(saved)
                                onSnackbar("日历记录已经收好。")
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = "保存失败：${failure.message}" }
                            finally { busy = false }
                        }
                    }
                }
            }) { Text(if (busy) "保存中…" else "保存") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("取消") } },
        shape = RoundedCornerShape(22.dp)
    )
    if (deleting && existing != null) DailyDeleteConfirmDialog(
        title = "删除这条日历记录？", body = existing.calendarText("title"),
        onDismiss = { deleting = false },
        onConfirm = {
            deleting = false; busy = true
            scope.launch {
                try { repository.deleteCalendar(existing.calendarText("id")); onChanged(null); onSnackbar("日历记录已经删除。") }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = "删除失败：${failure.message}" }
                finally { busy = false }
            }
        }
    )
}
