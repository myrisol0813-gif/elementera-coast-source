package com.elementeracoast.app.core.local

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.security.MessageDigest
import java.time.Instant

@Serializable
private data class TransferEnvelope(val format: String, val version: Int, val sha256: String, val payload_json: String)

/** Shared wire contract with Web. Hash the exact UTF-8 payload, not a platform-specific JSON reserialization. */
internal object CoastTransferCodec {
    const val FORMAT = "elementera-coast-transfer"
    const val VERSION = 1
    const val MAX_BYTES = 64 * 1024 * 1024
    const val CLOUD_REQUEST_MAX_BYTES = 8 * 1024 * 1024
    private val json = Json { ignoreUnknownKeys = false; encodeDefaults = true }
    private fun hash(raw: String) = MessageDigest.getInstance("SHA-256")
        .digest(raw.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }

    fun encode(payload: JsonObject): ByteArray {
        validate(payload)
        val raw = payload.toString()
        val bytes = json.encodeToString(TransferEnvelope.serializer(), TransferEnvelope(FORMAT, VERSION, hash(raw), raw)).encodeToByteArray()
        require(bytes.size <= MAX_BYTES) { "数据包超过 64 MiB；未截断资料。" }
        return bytes
    }

    fun decode(bytes: ByteArray): JsonObject {
        require(bytes.isNotEmpty() && bytes.size <= MAX_BYTES) { "数据包大小无效（最多 64 MiB）。" }
        val envelope = json.decodeFromString(TransferEnvelope.serializer(), bytes.decodeToString(throwOnInvalidSequence = true))
        require(envelope.format == FORMAT && envelope.version == VERSION) { "不支持的数据包格式或版本。" }
        require(envelope.sha256 == hash(envelope.payload_json)) { "数据包完整性校验失败。" }
        return json.parseToJsonElement(envelope.payload_json).jsonObject.also(::validate)
    }

    fun select(payload: JsonObject, selection: Set<String>): ByteArray {
        validate(payload)
        require(selection.isNotEmpty() && payload.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }.containsAll(selection))
        val filtered = JsonObject(payload + mapOf(
            "includedModules" to JsonArray(selection.sorted().map(::JsonPrimitive)),
            "conversations" to if ("chat" in selection) payload.getValue("conversations") else JsonArray(emptyList()),
            "calendar" to if ("calendar" in selection) payload.getValue("calendar") else JsonArray(emptyList()),
            "profile" to if ("model_profile" in selection) payload.getValue("profile") else JsonNull,
            "dailyProfile" to if ("daily" in selection) payload.getValue("dailyProfile") else JsonNull,
            "moments" to if ("daily" in selection) payload.getValue("moments") else JsonArray(emptyList()),
            "diaries" to if ("daily" in selection) payload.getValue("diaries") else JsonArray(emptyList())
        ))
        return encode(filtered)
    }

    val supportedModules = setOf("chat", "calendar", "daily", "model_profile")

    private fun validate(payload: JsonObject) {
        require(payload.keys == setOf("applicationId", "workspace", "exportedAt", "includedModules",
            "conversations", "calendar", "profile", "dailyProfile", "moments", "diaries"))
        val source = payload.getValue("applicationId").jsonPrimitive
        require(source.isString && source.content.matches(Regex("[A-Za-z0-9_.-]{1,100}")))
        require(payload.getValue("workspace").jsonPrimitive.content in setOf("local", "backend"))
        Instant.parse(payload.getValue("exportedAt").jsonPrimitive.content)
        val modules = payload.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }
        require(modules.all { it in supportedModules } && modules.distinct().size == modules.size)
        for (key in listOf("conversations", "calendar", "moments", "diaries")) require(payload[key] is JsonArray)
        for (key in listOf("profile", "dailyProfile")) require(payload[key] == JsonNull || payload[key] is JsonObject)
        if ("chat" !in modules) require(payload.getValue("conversations").jsonArray.isEmpty())
        if ("calendar" !in modules) require(payload.getValue("calendar").jsonArray.isEmpty())
        if ("daily" !in modules) require(payload["dailyProfile"] == JsonNull && payload.getValue("moments").jsonArray.isEmpty() && payload.getValue("diaries").jsonArray.isEmpty())
        if ("model_profile" !in modules) require(payload["profile"] == JsonNull)
    }
}
