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

    private fun validate(payload: JsonObject) {
        require(payload.keys == setOf("source", "exported_at", "modules", "excluded_modules"))
        val source = payload.getValue("source").jsonObject
        require(source.keys == setOf("application", "mode"))
        require(source.getValue("application").jsonPrimitive.isString &&
            source.getValue("application").jsonPrimitive.content.length in 1..100)
        require(source.getValue("mode").jsonPrimitive.content in setOf("local", "backend"))
        Instant.parse(payload.getValue("exported_at").jsonPrimitive.content)
        val modules = payload.getValue("modules").jsonObject
        require(modules.isNotEmpty() && modules.keys.all { it.matches(Regex("[a-z][a-z0-9_]{0,63}")) })
        require(payload.getValue("excluded_modules").jsonArray.all { it is JsonPrimitive && it.isString })
    }
}
