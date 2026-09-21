package com.elementeracoast.app.feature.actionlog

import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.core.local.LocalTextCodec
import com.elementeracoast.app.core.model.RoomType
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ActionLogStore(private val persistence: LocalPersistence) {
    private val sequence = AtomicLong(1)
    private val _records = MutableStateFlow(load())
    val records: StateFlow<List<LocalActionRecord>> = _records.asStateFlow()

    fun record(
        actionKey: String,
        label: String,
        roomType: RoomType,
        conversationId: String,
        inputSummary: String = "",
        outputSummary: String = "",
        errorMessage: String = "",
        assistantMessageId: Long? = null
    ): LocalActionRecord {
        val timestamp = Instant.now().toString()
        val record = LocalActionRecord(
            actionId = "local-action-${System.currentTimeMillis()}-${sequence.getAndIncrement()}",
            actionKey = actionKey.take(120),
            label = label.take(120),
            status = if (errorMessage.isBlank()) LocalActionStatus.Success else LocalActionStatus.Error,
            roomType = roomType,
            conversationId = conversationId.take(180),
            createdAt = timestamp,
            finishedAt = timestamp,
            inputSummary = redact(inputSummary),
            outputSummary = redact(outputSummary),
            errorMessage = redact(errorMessage),
            assistantMessageId = assistantMessageId
        )
        _records.value = (listOf(record) + _records.value).take(MAX_RECORDS)
        persist()
        return record
    }

    fun filtered(filter: ActionLogFilter): List<LocalActionRecord> = _records.value.filter { record ->
        (filter.status == null || record.status == filter.status) &&
            (filter.actionKey.isBlank() || record.actionKey == filter.actionKey) &&
            (filter.conversationId.isBlank() || record.conversationId == filter.conversationId) &&
            (filter.actionIds.isEmpty() || record.actionId in filter.actionIds)
    }

    fun clear() {
        _records.value = emptyList()
        persistence.remove(KEY)
    }

    private fun persist() {
        persistence.put(KEY, _records.value.joinToString("\n") { record ->
            LocalTextCodec.encodeFields(
                record.actionId,
                record.actionKey,
                record.label,
                record.status.name,
                record.roomType.wireValue,
                record.conversationId,
                record.createdAt,
                record.finishedAt,
                record.inputSummary,
                record.outputSummary,
                record.errorMessage,
                record.assistantMessageId?.toString().orEmpty()
            )
        })
    }

    private fun load(): List<LocalActionRecord> = persistence.get(KEY)
        .lineSequence()
        .filter { it.isNotBlank() }
        .mapNotNull { line ->
            val fields = LocalTextCodec.decodeFields(line)
            if (fields.size < 12) return@mapNotNull null
            LocalActionRecord(
                actionId = fields[0],
                actionKey = fields[1],
                label = fields[2],
                status = runCatching { LocalActionStatus.valueOf(fields[3]) }.getOrDefault(LocalActionStatus.Success),
                roomType = RoomType.fromWire(fields[4]),
                conversationId = fields[5],
                createdAt = fields[6],
                finishedAt = fields[7],
                inputSummary = fields[8],
                outputSummary = fields[9],
                errorMessage = fields[10],
                assistantMessageId = fields[11].toLongOrNull()
            )
        }
        .take(MAX_RECORDS)
        .toList()

    private fun redact(value: String): String = value
        .replace(Regex("[\\r\\n]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
        .take(360)

    companion object {
        private const val KEY = "actionlog.records"
        private const val MAX_RECORDS = 200
    }
}
