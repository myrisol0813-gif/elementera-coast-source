package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class RemoteModelMetadataSummary(
    val status: String = "not_returned",
    val sanitized: Boolean = true,
    @SerialName("has_reasoning") val hasReasoning: Boolean = false,
    @SerialName("has_usage") val hasUsage: Boolean = false,
    val provider: String? = null,
    @SerialName("resolved_model") val resolvedModel: String? = null,
    @SerialName("encrypted_content_present") val encryptedContentPresent: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class RemoteModelUsage(
    @SerialName("prompt_tokens") val promptTokens: Long? = null,
    @SerialName("completion_tokens") val completionTokens: Long? = null,
    @SerialName("reasoning_tokens") val reasoningTokens: Long? = null,
    @SerialName("cached_tokens") val cachedTokens: Long? = null,
    @SerialName("total_tokens") val totalTokens: Long? = null,
    val cost: Double? = null
)

@Serializable
data class RemoteModelRequestMetadata(
    val temperature: Double? = null,
    @SerialName("top_p") val topP: Double? = null,
    @SerialName("max_tokens") val maxTokens: Long? = null,
    @SerialName("reasoning_effort") val reasoningEffort: String? = null,
    @SerialName("reasoning_max_tokens") val reasoningMaxTokens: Long? = null,
    val stream: Boolean? = null,
    @SerialName("response_format") val responseFormat: JsonElement? = null
)

@Serializable
data class RemoteModelMetadata(
    val provider: String? = null,
    @SerialName("requested_model") val requestedModel: String? = null,
    @SerialName("resolved_model") val resolvedModel: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("reasoning_text") val reasoningText: String? = null,
    @SerialName("reasoning_summary") val reasoningSummary: String? = null,
    @SerialName("reasoning_details") val reasoningDetails: JsonElement? = null,
    @SerialName("reasoning_encrypted_content_present") val reasoningEncryptedContentPresent: Boolean = false,
    @SerialName("reasoning_encrypted_content_length") val reasoningEncryptedContentLength: Long? = null,
    @SerialName("reasoning_encrypted_content_digest") val reasoningEncryptedContentDigest: String? = null,
    @SerialName("reasoning_status") val reasoningStatus: String = "not_returned",
    val usage: RemoteModelUsage? = null,
    @SerialName("finish_reason") val finishReason: String? = null,
    @SerialName("native_finish_reason") val nativeFinishReason: String? = null,
    @SerialName("is_stream") val isStream: Boolean? = null,
    @SerialName("is_aborted") val isAborted: Boolean = false,
    @SerialName("is_timeout") val isTimeout: Boolean = false,
    @SerialName("error_summary") val errorSummary: String? = null,
    @SerialName("tool_calls") val toolCalls: JsonElement? = null,
    @SerialName("tool_results") val toolResults: JsonElement? = null,
    val request: RemoteModelRequestMetadata? = null,
    @SerialName("provider_route") val providerRoute: JsonElement? = null
)

@Serializable
data class RemoteMessageModelMetadataResponse(
    val ok: Boolean = false,
    @SerialName("message_id") val messageId: String = "",
    @SerialName("conversation_id") val conversationId: String = "",
    val status: String = "not_returned",
    val sanitized: Boolean = true,
    val metadata: RemoteModelMetadata? = null,
    @SerialName("raw_metadata_sanitized") val rawMetadataSanitized: JsonElement? = null
)
