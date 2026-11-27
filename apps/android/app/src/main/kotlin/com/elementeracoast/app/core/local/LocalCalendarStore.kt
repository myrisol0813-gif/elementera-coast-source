package com.elementeracoast.app.core.local

import com.elementeracoast.app.feature.daily.CalendarAnniversary
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID
import kotlinx.serialization.json.*

internal class LocalCalendarError(val type: String, message: String, val status: Int = 400) : IllegalArgumentException(message)

/** One durable record per calendar item. Pinned cards are a derived view, never a second store. */
internal class LocalCalendarStore(private val persistence: LocalPersistence) {
    private fun all(): List<JsonObject> = Json.parseToJsonElement(persistence.get(KEY, "[]")).jsonArray.map { it.jsonObject }
    private fun write(entries: List<JsonObject>) = persistence.put(KEY, JsonArray(entries).toString())
    private fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    private fun day(value: String): LocalDate = try {
        require(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(value))
        LocalDate.parse(value).also { require(it.year in 1900..2200) }
    } catch (_: Exception) { throw LocalCalendarError("invalid_day", "请填写有效的公历日期（1900—2200）。") }

    private fun anniversary(value: JsonElement?): CalendarAnniversary? {
        if (value == null || value == JsonNull) return null
        try {
            val data = value.jsonObject
            require(data.keys.all { it in setOf("startDay", "mode", "targetDays", "pinned") })
            val pin = data["pinned"]?.jsonPrimitive
            require(pin != null && !pin.isString && pin.booleanOrNull != null)
            val target = data["targetDays"]?.takeUnless { it == JsonNull }?.jsonPrimitive
            require(target == null || (!target.isString && target.intOrNull != null))
            return CalendarAnniversary(day(data.text("startDay")), data.text("mode"), target?.intOrNull, pin.boolean)
        } catch (_: Exception) { throw LocalCalendarError("invalid_anniversary", "纪念日日期或目标天数无效。") }
    }

    private fun CalendarAnniversary.toJson(): JsonObject = buildJsonObject {
        put("startDay", startDay.toString()); put("mode", mode)
        put("targetDays", targetDays?.let(::JsonPrimitive) ?: JsonNull); put("pinned", pinned)
    }

    fun list(month: String?, pinned: Boolean = false, today: String? = null): List<JsonObject> {
        val entries = all()
        if (pinned) {
            val date = today?.let(::day)
            return entries.filter { anniversary(it["anniversary"])?.pinned == true }
                .sortedWith(compareBy({ it["created_at"]?.jsonPrimitive?.longOrNull ?: 0L }, { it.text("id") }))
                .map { row ->
                    val status = date?.let { anniversary(row["anniversary"])!!.status(it) }
                    if (status == null) row else JsonObject(row + ("status" to buildJsonObject {
                        put("phase", status.phase); put("days", status.days?.let(::JsonPrimitive) ?: JsonNull)
                        put("day", status.day?.toString()?.let(::JsonPrimitive) ?: JsonNull)
                    }))
                }
        }
        val selected = try {
            (month?.let(YearMonth::parse) ?: YearMonth.now()).also { require(it.year in 1900..2200) }
        } catch (_: Exception) { throw LocalCalendarError("invalid_month", "月份应为 YYYY-MM 格式。") }
        return entries.mapNotNull { entry ->
            val origin = day(entry.text("day"))
            val occurrence = if (entry.text("recurrence") == "yearly") {
                if (selected.year < origin.year || selected.monthValue != origin.monthValue) return@mapNotNull null
                runCatching { LocalDate.of(selected.year, origin.monthValue, origin.dayOfMonth) }.getOrNull()
            } else origin
            if (occurrence == null || YearMonth.from(occurrence) != selected) null
            else JsonObject(entry + ("occurrence_day" to JsonPrimitive(occurrence.toString())))
        }.sortedWith(compareBy({ it.text("occurrence_day") }, { it["created_at"]?.jsonPrimitive?.longOrNull ?: 0L }))
    }

    fun snapshot(): JsonArray = JsonArray(all())

    internal fun restoreSnapshot(rows: JsonArray) { validateBackup(rows); write(rows.map { it.jsonObject }) }

    fun save(id: String?, patch: JsonObject): JsonObject {
        val entries = all()
        val previous = id?.let { key -> entries.firstOrNull { it.text("id") == key }
            ?: throw LocalCalendarError("not_found", "没有找到这条日历记录。", 404) }
        if (patch.keys.any { it !in setOf("day", "title", "body", "kind", "recurrence", "anniversary") } || (previous != null && patch.isEmpty()))
            throw LocalCalendarError("invalid_field", "日历中含有不支持的字段或没有修改内容。")
        val merged = JsonObject(previous.orEmpty() + patch)
        var date = day(merged.text("day"))
        val title = merged.text("title").trim()
        val body = merged.text("body").trim()
        if (title.isBlank() || title.length > 120 || body.length > 4000)
            throw LocalCalendarError("invalid_text", "标题须为 1—120 字，内容最多 4000 字。")
        var kind = merged.text("kind").ifBlank { "event" }
        var recurrence = merged.text("recurrence").ifBlank { "none" }
        if (kind !in setOf("event", "note") || recurrence !in setOf("none", "yearly"))
            throw LocalCalendarError("invalid_field", "日历类型或重复方式无效。")
        val ann = anniversary(merged["anniversary"])
        if (ann != null) {
            if ("anniversary" !in patch && (("day" in patch && date != ann.calendarDay) ||
                ("kind" in patch && kind != "event") || ("recurrence" in patch && recurrence != ann.recurrence)))
                throw LocalCalendarError("anniversary_conflict", "请通过纪念日设置修改日期或计算方式。")
            date = ann.calendarDay; kind = "event"; recurrence = ann.recurrence
        }
        val key = id ?: UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val row = buildJsonObject {
            put("id", key); put("day", date.toString()); put("occurrence_day", date.toString())
            put("title", title); put("body", body); put("kind", kind); put("recurrence", recurrence)
            put("author", previous?.get("author") ?: JsonPrimitive("owner")); put("source", previous?.get("source") ?: JsonPrimitive("local"))
            for (field in listOf("model_label", "tool_call_id", "conversation_id", "source_turn_id")) previous?.get(field)?.let { put(field, it) }
            put("created_at", previous?.get("created_at") ?: JsonPrimitive(now)); put("updated_at", now)
            if (ann != null) put("anniversary", ann.toJson())
        }
        write(if (previous == null) entries + row else entries.map { if (it.text("id") == key) row else it })
        return row
    }

    fun delete(id: String) {
        val entries = all()
        if (entries.none { it.text("id") == id }) throw LocalCalendarError("not_found", "没有找到这条日历记录。", 404)
        write(entries.filterNot { it.text("id") == id })
    }

    companion object {
        private const val KEY = "local.calendar.entries.v1"

        /** Validate portable records using the same date/anniversary rules as the editor. No writes. */
        fun validateBackup(rows: JsonArray) {
            val validator = LocalCalendarStore(MemoryLocalPersistence())
            val ids = mutableSetOf<String>()
            val toolIds = mutableSetOf<String>()
            rows.forEach { value ->
                val row = value.jsonObject
                require(row.keys.all { it in setOf("id", "day", "occurrence_day", "title", "body", "kind", "recurrence", "author", "source", "created_at", "updated_at", "anniversary", "model_label", "tool_call_id", "conversation_id", "source_turn_id") })
                val id = with(validator) { row.text("id") }
                require(id.matches(Regex("[A-Za-z0-9_.:-]{1,160}")) && ids.add(id))
                for (field in listOf("model_label", "tool_call_id")) {
                    val item = row[field] ?: continue
                    require(item is JsonPrimitive && item.isString && item.content.length <= 200)
                    if (field == "tool_call_id") require(toolIds.add(item.content)) { "日历工具调用 ID 重复。" }
                }
                for (field in listOf("conversation_id", "source_turn_id")) {
                    val item = row[field] ?: continue
                    // Independent model activity has a real window and tool claim, but no chat turn.
                    if (field == "source_turn_id" && item == JsonNull) {
                        require(row["source"] == JsonPrimitive("chat_tool") &&
                            row["tool_call_id"]?.jsonPrimitive?.contentOrNull.orEmpty().startsWith("dream:"))
                        continue
                    }
                    require(item is JsonPrimitive && item.isString && item.content.matches(Regex("[A-Za-z0-9_.:-]{1,160}")))
                }
                require(row["source_turn_id"] == null || row["conversation_id"] != null) { "日历来源轮次缺少窗口 ID。" }
                val date = validator.day(with(validator) { row.text("day") })
                val title = with(validator) { row.text("title") }
                val body = with(validator) { row.text("body") }
                val kind = with(validator) { row.text("kind") }
                val recurrence = with(validator) { row.text("recurrence") }
                require(title.isNotBlank() && title.length <= 120 && body.length <= 4000)
                require(kind in setOf("event", "note") && recurrence in setOf("none", "yearly"))
                require(row["created_at"]?.jsonPrimitive?.longOrNull != null && row["updated_at"]?.jsonPrimitive?.longOrNull != null)
                validator.anniversary(row["anniversary"])?.let { ann ->
                    require(date == ann.calendarDay && kind == "event" && recurrence == ann.recurrence)
                }
            }
        }
    }
}
