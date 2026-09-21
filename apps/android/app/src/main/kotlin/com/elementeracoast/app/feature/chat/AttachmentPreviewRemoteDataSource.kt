package com.elementeracoast.app.feature.chat

import android.content.Context
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.network.CoastHttpClient
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** Read-only attachment loader used only for persisted image thumbnails. */
class AttachmentPreviewRemoteDataSource(
    private val config: CoastApiConfig,
    private val client: OkHttpClient
) {
    suspend fun get(conversationId: String, attachmentId: String): ByteArray = withContext(Dispatchers.IO) {
        val path = buildString {
            append("/api/chat/attachments/")
            append(segment(attachmentId))
            append("?conversation_id=")
            append(query(conversationId))
        }
        try {
            client.newCall(Request.Builder().url(config.url(path)).get().build()).execute().use { response ->
                if (!response.isSuccessful) {
                    throw CoastApiException(
                        kind = when (response.code) {
                            401 -> CoastApiErrorKind.Unauthorized
                            404 -> CoastApiErrorKind.NotFound
                            else -> CoastApiErrorKind.Request
                        },
                        type = if (response.code == 404) "attachment_not_found" else "attachment_preview_failed",
                        message = if (response.code == 404) "找不到这张图片。" else "图片缩略图读取失败（${response.code}）。",
                        status = response.code
                    )
                }
                val declared = response.body?.contentLength() ?: -1L
                if (declared > MAX_PREVIEW_BYTES) {
                    throw CoastApiException(CoastApiErrorKind.Request, "attachment_preview_too_large", "图片太大，暂不生成缩略图。", 413)
                }
                val bytes = response.body?.bytes() ?: ByteArray(0)
                if (bytes.isEmpty()) throw CoastApiException(CoastApiErrorKind.Decode, "attachment_preview_empty", "图片缩略图为空。")
                if (bytes.size > MAX_PREVIEW_BYTES) throw CoastApiException(CoastApiErrorKind.Request, "attachment_preview_too_large", "图片太大，暂不生成缩略图。", 413)
                bytes
            }
        } catch (error: CoastApiException) {
            throw error
        } catch (error: IOException) {
            throw CoastApiException(CoastApiErrorKind.Network, "network_unreachable", "暂时无法读取图片缩略图。", cause = error)
        }
    }

    private fun query(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
    private fun segment(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    companion object {
        private const val MAX_PREVIEW_BYTES = 8 * 1024 * 1024

        fun production(context: Context): AttachmentPreviewRemoteDataSource {
            val appContext = context.applicationContext
            val config = CoastApiConfig.production()
            val authStore = AndroidKeystoreAuthStore(appContext)
            val http = CoastHttpClient(config, authStore).client
            return AttachmentPreviewRemoteDataSource(config, http)
        }
    }
}
