package com.elementeracoast.app.feature.chat

import android.content.Context
import android.media.MediaPlayer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.UUID

data class VoiceClip(val id: String, val messageId: String, val turnId: String, val text: String)

internal fun decodeVoiceClips(response: JsonObject): List<VoiceClip> =
    (response["clips"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { value ->
        val row = value as? JsonObject ?: return@mapNotNull null
        val id = row["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
        if (id.isBlank()) return@mapNotNull null
        VoiceClip(id,
            row["message_id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            row["turn_id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            row["text"]?.jsonPrimitive?.contentOrNull.orEmpty())
    }

/** Audio files remain in Coast; local MP3 files are only temporary playback buffers. */
internal class PrivateClipPlayer(private val context: Context) : AutoCloseable {
    private var media: MediaPlayer? = null
    private var temp: File? = null
    fun play(data: ByteArray) {
        close()
        val file = File(context.cacheDir, "coast-voice-${UUID.randomUUID()}.mp3")
        file.writeBytes(data)
        temp = file
        val player = MediaPlayer()
        try {
            player.setDataSource(file.absolutePath)
            player.setOnCompletionListener { close() }
            player.prepare()
            media = player
            player.start()
        } catch (error: Exception) {
            player.release()
            close()
            throw error
        }
    }
    override fun close() {
        media?.runCatching { stop(); release() }
        media = null
        temp?.delete()
        temp = null
    }
}

@Composable
internal fun VoiceSelectionDialog(
    message: ChatMessage,
    onDismiss: () -> Unit,
    onGenerate: (List<Int>) -> Unit,
    working: Boolean
) {
    val paragraphs = remember(message.remoteVariantId, message.text) {
        message.text.split(Regex("\\n\\s*\\n")).map { it.trim() }.filter(String::isNotEmpty)
    }
    var indices by remember(message.id) { mutableStateOf<Set<Int>>(emptySet()) }
    val count = indices.sorted().joinToString("\n\n") { paragraphs[it] }.length
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("留下 模型伙伴 的声音") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("勾选本条回复的段落，使用 ElevenLabs 模型伙伴 v0.1 声线生成，会消耗 ElevenLabs 额度。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("已选 ${count} / 2400 字 · 同一消息最多留存 12 段语音，单次最多选择 40 段",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary)
                Column(Modifier.heightIn(max = 330.dp).verticalScroll(rememberScrollState())) {
                    paragraphs.forEachIndexed { index, paragraph ->
                        Row(verticalAlignment = Alignment.Top) {
                            Checkbox(checked = index in indices, onCheckedChange = { checked ->
                                indices = if (checked) indices + index else indices - index
                            })
                            Text(paragraph, modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !working && indices.isNotEmpty() && count <= 2400,
                onClick = { onGenerate(indices.sorted()) }) {
                Text(if (working) "正在生成并保存…" else "确认生成")
            }
        },
        dismissButton = { TextButton(enabled = !working, onClick = onDismiss) { Text("取消") } }
    )
}
