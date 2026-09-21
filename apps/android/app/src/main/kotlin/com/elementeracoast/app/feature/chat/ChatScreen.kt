package com.elementeracoast.app.feature.chat

import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.feature.dogtalk.CrossWindowRepository
import com.elementeracoast.app.feature.dogtalk.CrossWindowUiState
import com.elementeracoast.app.feature.dogtalk.DogtalkCard
import com.elementeracoast.app.feature.dogtalk.DogtalkRepository
import com.elementeracoast.app.feature.dogtalk.DogtalkScope
import com.elementeracoast.app.ui.theme.SnowLetterChatScaffold
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ChatWindow(
    state: CoastShellState,
    dogtalk: DogtalkRepository,
    crossWindowRepository: CrossWindowRepository,
    crossWindow: CrossWindowUiState,
    onCrossWindowChange: (CrossWindowUiState) -> Unit,
    onUploadAttachment: (String, String, ByteArray) -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onMessageAction: (MessageAction) -> Unit,
    onOpenActionLog: (Set<String>) -> Unit,
    onOpenPendingMemory: () -> Unit,
    onPlaceholder: (String) -> Unit
) {
    var input by rememberSaveable(state.activeConversationId) { mutableStateOf("") }
    var avatarDialogOpen by rememberSaveable { mutableStateOf(false) }
    var editingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var soilOpen by rememberSaveable { mutableStateOf(false) }
    var deskOpen by rememberSaveable { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val attachmentScope = rememberCoroutineScope()
    val toolNotice by ToolActivityBus.notice.collectAsState()

    fun acceptPickedUris(uris: List<Uri>) {
        if (uris.isEmpty()) return
        attachmentScope.launch {
            uris.take(12).forEach { uri ->
                when (val picked = readPickedAttachment(context, uri)) {
                    is PickedAttachmentResult.Ready -> onUploadAttachment(
                        picked.name,
                        picked.mime,
                        picked.bytes
                    )
                    is PickedAttachmentResult.Failed -> onPlaceholder(picked.message)
                }
            }
        }
    }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        acceptPickedUris(uris)
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        acceptPickedUris(uris)
    }
    val metadataSource = remember(context.applicationContext) {
        ModelMetadataRemoteDataSource.production(context.applicationContext)
    }
    val attachmentPreviewSource = remember(context.applicationContext) {
        AttachmentPreviewRemoteDataSource.production(context.applicationContext)
    }
    val avatarSource = state.modelPartnerAvatarDataUrl
    val persistedDeskReceipt = state.messages.lastOrNull()
        ?.takeIf { it.role == MessageRole.Assistant }
        ?.deskReceipt
    val deskReceipt = persistedDeskReceipt ?: state.turnDeskReceipt

    LaunchedEffect(toolNotice?.id) {
        val id = toolNotice?.id ?: return@LaunchedEffect
        delay(2200)
        ToolActivityBus.clear(id)
    }

    val avatarBitmap by produceState<ImageBitmap?>(initialValue = null, avatarSource) {
        value = if (avatarSource.isBlank()) null else withContext(Dispatchers.IO) { decodeImageSource(context, avatarSource) }
    }

    SnowLetterChatScaffold(modifier = Modifier.fillMaxSize().imePadding()) {
        Column(modifier = Modifier.fillMaxSize()) {
            ChatTimeline(
                conversationId = state.activeConversationId,
                messages = state.messages,
                thoughtSoil = state.thoughtSoil,
                isStreaming = state.isStreaming,
                streamingMessageId = state.streamingMessageId,
                avatarBitmap = avatarBitmap,
                metadataSource = metadataSource,
                attachmentPreviewSource = attachmentPreviewSource,
                onAvatarClick = { avatarDialogOpen = true },
                onCopy = { message ->
                    clipboard.setText(AnnotatedString(message.text))
                    onMessageAction(MessageAction.Copy(message.id))
                    onPlaceholder("已复制")
                },
                onEdit = { message -> editingMessage = message },
                onAction = onMessageAction,
                onFootprint = { message ->
                    val model = message.modelId ?: "未知模型"
                    val source = message.generationSource ?: "unknown"
                    onPlaceholder("生成足迹：$model · $source")
                },
                onOpenActionLog = onOpenActionLog,
                onOpenThoughtSoil = { if (state.thoughtSoil != null) soilOpen = true },
                modifier = Modifier.weight(1f)
            )

            toolNotice?.let { notice ->
                ToolActivityPopup(
                    notice = notice,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                )
            }
            deskReceipt?.let { receipt -> TurnDeskStatusStrip(receipt = receipt, onClick = { deskOpen = true }) }
            DogtalkCard(
                scope = DogtalkScope.from(state.activeRoomType),
                conversationId = state.activeConversationId,
                repository = dogtalk,
                crossWindowRepository = crossWindowRepository,
                crossWindow = crossWindow,
                onCrossWindowChange = onCrossWindowChange,
                historyLoading = state.historyLoading,
                isStreaming = state.isStreaming,
                onNotice = onPlaceholder
            )
            HorizontalDivider(color = androidx.compose.material3.MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f))
            CoastComposer(
                conversationId = state.activeConversationId,
                value = input,
                onValueChange = { input = it },
                pendingAttachments = state.pendingAttachments,
                attachmentUploading = state.attachmentUploading,
                previewSource = attachmentPreviewSource,
                isStreaming = state.isStreaming,
                enabled = !state.historyLoading,
                onPickImage = { imagePicker.launch(arrayOf("image/png", "image/jpeg", "image/webp")) },
                onPickFile = { filePicker.launch(arrayOf("*/*")) },
                onRemoveAttachment = onRemovePendingAttachment,
                onSend = { val outgoing = input; input = ""; onSend(outgoing) },
                onStop = onStop,
                onPlaceholder = onPlaceholder
            )
        }
    }

    val soil = state.thoughtSoil
    if (soilOpen && soil != null) {
        SoilBottomSheet(
            soil = soil,
            onOpenPendingBag = onOpenPendingMemory,
            onDismiss = { soilOpen = false }
        )
    }

    if (deskOpen && deskReceipt != null) TurnDeskBottomSheet(receipt = deskReceipt, onDismiss = { deskOpen = false })

    if (avatarDialogOpen) {
        AvatarPickerDialog(
            onDismiss = { avatarDialogOpen = false },
            onUploadLater = {
                avatarDialogOpen = false
                onPlaceholder("请从小组件的头像入口更新；同一张头像会回到聊天窗口。")
            }
        )
    }

    editingMessage?.let { message ->
        EditMessageDialog(
            message = message,
            onDismiss = { editingMessage = null },
            onSave = { text -> onMessageAction(MessageAction.Edit(message.id, text)); editingMessage = null }
        )
    }
}

private sealed interface PickedAttachmentResult {
    data class Ready(
        val name: String,
        val mime: String,
        val bytes: ByteArray
    ) : PickedAttachmentResult

    data class Failed(val message: String) : PickedAttachmentResult
}

private suspend fun readPickedAttachment(
    context: android.content.Context,
    uri: Uri
): PickedAttachmentResult = withContext(Dispatchers.IO) {
    runCatching {
        val resolver = context.contentResolver
        var name = "附件"
        var declaredSize = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex).orEmpty().ifBlank { name }
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) declaredSize = cursor.getLong(sizeIndex)
            }
        }
        if (declaredSize > 8L * 1024L * 1024L) {
            return@withContext PickedAttachmentResult.Failed("${name} 超过当前 8 MB 上传上限。")
        }
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: return@withContext PickedAttachmentResult.Failed("${name} 无法读取。")
        if (bytes.isEmpty()) return@withContext PickedAttachmentResult.Failed("${name} 是空文件。")
        if (bytes.size > 8 * 1024 * 1024) {
            return@withContext PickedAttachmentResult.Failed("${name} 超过当前 8 MB 上传上限。")
        }
        PickedAttachmentResult.Ready(
            name = name.take(180),
            mime = resolver.getType(uri).orEmpty().ifBlank { "application/octet-stream" },
            bytes = bytes
        )
    }.getOrElse { error ->
        PickedAttachmentResult.Failed("附件读取失败：${error.message ?: "未知错误"}")
    }
}

private fun decodeImageSource(context: android.content.Context, source: String): ImageBitmap? = runCatching {
    val bitmap = if (source.startsWith("data:image/", ignoreCase = true)) {
        val encoded = source.substringAfter(',', "")
        if (encoded.isBlank()) null else {
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
    } else {
        context.contentResolver.openInputStream(Uri.parse(source)).use { stream -> BitmapFactory.decodeStream(stream) }
    }
    bitmap?.asImageBitmap()
}.getOrNull()
