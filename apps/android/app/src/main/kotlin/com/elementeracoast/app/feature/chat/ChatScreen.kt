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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.elementeracoast.app.feature.daily.SideRoomsRepository
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.put
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
    onComposerDraftChange: (String) -> Unit,
    onSend: (String) -> Unit,
    onSendImage: (String) -> Unit = {},
    onStop: () -> Unit,
    onMessageAction: (MessageAction) -> Unit,
    onOpenActionLog: (Set<String>) -> Unit,
    onOpenPendingMemory: () -> Unit,
    onSetThoughtSoilEnabled: (Boolean) -> Unit,
    onSaveThoughtSoil: (String, List<String>) -> Unit,
    onResumeThoughtSoil: () -> Unit,
    onPlaceholder: (String) -> Unit,
    guideTarget: String? = null,
    onGuideConsumed: () -> Unit = {}
) {
    val input = state.composerDraft
    var avatarDialogOpen by rememberSaveable { mutableStateOf(false) }
    var editingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var soilOpen by rememberSaveable { mutableStateOf(false) }
    var selectedSoil by remember(state.activeConversationId) { mutableStateOf<com.elementeracoast.app.core.model.ThoughtSoilSnapshot?>(null) }
    var soilTreasureTarget by remember(state.activeConversationId) { mutableStateOf<com.elementeracoast.app.core.model.ThoughtSoilSnapshot?>(null) }
    var deskOpen by rememberSaveable(state.activeConversationId) { mutableStateOf(false) }
    var selectedHistoryDesk by remember(state.activeConversationId){mutableStateOf<ChatMessage?>(null)}
    var drawerOpen by rememberSaveable(state.activeConversationId) { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val attachmentScope = rememberCoroutineScope()
    val sideRooms = remember(context.applicationContext) { SideRoomsRepository.production(context.applicationContext) }
    val voicePlayer = remember(context.applicationContext) { PrivateClipPlayer(context.applicationContext) }
    var voiceClips by remember(state.activeConversationId) { mutableStateOf<List<VoiceClip>>(emptyList()) }
    var voiceTarget by remember(state.activeConversationId) { mutableStateOf<ChatMessage?>(null) }
    var voiceWorking by remember(state.activeConversationId) { mutableStateOf(false) }
    var treasureTarget by remember(state.activeConversationId) { mutableStateOf<ChatMessage?>(null) }
    var treasureRevision by remember(state.activeConversationId) { mutableIntStateOf(0) }
    var treasureRows by remember(state.activeConversationId) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var treasureLoaded by remember(state.activeConversationId) { mutableStateOf(false) }
    LaunchedEffect(state.activeConversationId, treasureRevision) {
        val conversationId = state.activeConversationId
        if (conversationId.isBlank()) return@LaunchedEffect
        treasureLoaded = false
        try {
            val all = mutableListOf<JsonObject>()
            var cursor = ""
            for (page in 0 until 250) {
                val response = sideRooms.vaultTreasures(conversationId = conversationId, cursor = cursor)
                all.addAll((response["items"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject })
                cursor = response["next_cursor"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (cursor.isBlank()) break
            }
            if (cursor.isNotBlank()) throw IllegalStateException("收藏数量超出当前查看上限。")
            treasureRows = all
            treasureLoaded = true
        } catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { treasureLoaded = false }
    }
    fun treasureField(item: JsonObject, key: String): String =
        item[key]?.jsonPrimitive?.contentOrNull.orEmpty()
    val favoritedIds = treasureRows.mapNotNull { row ->
        treasureField(row, "message_id").takeIf { it.isNotBlank() }
    }.toSet()
    val userMediaTurns = treasureRows.filter {
        treasureField(it, "kind") in setOf("image", "file")
    }.map { treasureField(it, "turn_id") }.toSet()
    val visibleMessages = state.messages.map { message ->
        if (!treasureLoaded) message else message.copy(favorite =
            message.remoteVariantId.orEmpty() in favoritedIds ||
            (message.role == MessageRole.User && message.turnId.orEmpty() in userMediaTurns))
    }

    DisposableEffect(voicePlayer) { onDispose { voicePlayer.close() } }
    val latestAssistantVariant = state.messages.lastOrNull { it.role == MessageRole.Assistant }?.remoteVariantId
    LaunchedEffect(state.activeConversationId, latestAssistantVariant, state.isStreaming) {
        val conversationId = state.activeConversationId
        if (conversationId.isBlank() || state.isStreaming) return@LaunchedEffect
        try { voiceClips = decodeVoiceClips(sideRooms.voiceClips(conversationId)) }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (error: Exception) { onPlaceholder("语音读取失败：${error.message}") }
    }
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
    var drawerGuidePane by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(guideTarget) {
        when (guideTarget) {
            "drawer" -> drawerOpen = true
            "draft", "cross" -> { drawerGuidePane = if (guideTarget == "draft") "dogtalk" else "cross"; drawerOpen = true }
            "desk" -> if (deskReceipt != null) deskOpen = true else { drawerOpen = true; onPlaceholder("完成一轮对话后即可查看本轮上下文预览。") }
            "soil" -> if (state.thoughtSoil != null) { selectedSoil = null; soilOpen = true } else onPlaceholder("当前窗口暂无纸条，可在右上角菜单开启整理。")
            else -> return@LaunchedEffect
        }
        onGuideConsumed()
    }

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
                messages = visibleMessages,
                searchFocus = state.searchFocus,
                thoughtSoil = state.thoughtSoil,
                isStreaming = state.isStreaming,
                streamingMessageId = state.streamingMessageId,
                avatarBitmap = avatarBitmap,
                metadataSource = metadataSource,
                attachmentPreviewSource = attachmentPreviewSource,
                onAvatarClick = { avatarDialogOpen = true },
                onCopy = { message ->
                    clipboard.setText(AnnotatedString(if(message.role==com.elementeracoast.app.core.model.MessageRole.Assistant)com.elementeracoast.app.core.model.ReplySegments.plain(message.text) else message.text))
                    onMessageAction(MessageAction.Copy(message.id))
                    onPlaceholder("已复制")
                },
                onEdit = { message -> editingMessage = message },
                voiceClips = voiceClips,
                onVoice = { voiceTarget = it },
                onPlayVoice = { clipId ->
                    attachmentScope.launch {
                        try { voicePlayer.play(sideRooms.audio(clipId)) }
                        catch (error: Exception) { onPlaceholder("语音播放失败：${error.message}") }
                    }
                },
                onAction = { action ->
                    if (action is MessageAction.ToggleFavorite) {
                        treasureTarget = state.messages.firstOrNull { it.id == action.messageId }
                    } else onMessageAction(action)
                },
                onOpenHistoryDesk={message->selectedHistoryDesk=message;deskOpen=true},
                onFootprint = { message ->
                    val model = message.modelId ?: "未知模型"
                    val source = message.generationSource ?: "unknown"
                    onPlaceholder("生成足迹：$model · $source")
                },
                onOpenActionLog = onOpenActionLog,
                onOpenThoughtSoil = { clicked -> selectedSoil = clicked; soilOpen = true },
                modifier = Modifier.weight(1f)
            )

            toolNotice?.let { notice ->
                ToolActivityPopup(
                    notice = notice,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                )
            }
            DogtalkCard(
                scope = DogtalkScope.from(state.activeRoomType),
                conversationId = state.activeConversationId,
                repository = dogtalk,
                crossWindowRepository = crossWindowRepository,
                crossWindow = crossWindow,
                onCrossWindowChange = onCrossWindowChange,
                turnDeskReceipt = deskReceipt,
                guidePane = drawerGuidePane,
                onGuidePaneConsumed = { drawerGuidePane = null },
                open = drawerOpen,
                onOpenChange = { drawerOpen = it },
                onOpenTurnDesk = { if (deskReceipt != null) deskOpen = true },
                historyLoading = state.historyLoading,
                isStreaming = state.isStreaming,
                onNotice = onPlaceholder
            )
            if (state.backgroundGeneration) {
                androidx.compose.material3.Text("另一个窗口正在生成或整理；可以先写草稿。", style = androidx.compose.material3.MaterialTheme.typography.labelSmall, color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            }
            HorizontalDivider(color = androidx.compose.material3.MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f))
            CoastComposer(
                conversationId = state.activeConversationId,
                value = input,
                onValueChange = onComposerDraftChange,
                pendingAttachments = state.pendingAttachments,
                attachmentUploading = state.attachmentUploading,
                previewSource = attachmentPreviewSource,
                isStreaming = state.isStreaming,
                isFinalizing = state.isFinalizing,
                enabled = !state.historyLoading,
                drawerOpen = drawerOpen,
                onToggleDrawer = { drawerOpen = !drawerOpen },
                onPickImage = { imagePicker.launch(arrayOf("image/png", "image/jpeg", "image/webp")) },
                onPickFile = { filePicker.launch(arrayOf("*/*")) },
                onRemoveAttachment = onRemovePendingAttachment,
                onSend = { onSend(input) },
                onGenerateImage = { onSendImage(input) },
                onStop = onStop,
                onPlaceholder = onPlaceholder
            )
        }
    }

    val soil = if (selectedSoil?.isHistorical == true) selectedSoil else state.thoughtSoil
    if (soilOpen && soil != null) {
        SoilBottomSheet(
            soil = soil,
            onSetEnabled = onSetThoughtSoilEnabled,
            onSave = onSaveThoughtSoil,
            onResumeAutomatic = onResumeThoughtSoil,
            onOpenPendingBag = onOpenPendingMemory,
            onTreasure = { historical ->
                soilOpen = false
                selectedSoil = null
                soilTreasureTarget = historical
            },
            onDismiss = { soilOpen = false; selectedSoil = null }
        )
    }

    soilTreasureTarget?.let { historical ->
        SoilTreasureDialog(
            soil = historical,
            repository = sideRooms,
            onDismiss = { soilTreasureTarget = null },
            onSaved = {
                soilTreasureTarget = null
                treasureRevision += 1
                onPlaceholder("旧思维壤的珍藏已更新，原来的土层仍在。")
            }
        )
    }

    val openedDesk=selectedHistoryDesk?.deskReceipt?:deskReceipt
    if (deskOpen && openedDesk != null) TurnDeskBottomSheet(receipt = openedDesk, historical=selectedHistoryDesk!=null,
        onDismiss = { deskOpen = false;selectedHistoryDesk=null })

    if (avatarDialogOpen) {
        AvatarPickerDialog(
            onDismiss = { avatarDialogOpen = false },
            onUploadLater = {
                avatarDialogOpen = false
                onPlaceholder("请从小组件的头像入口更新；同一张头像会回到聊天窗口。")
            }
        )
    }

    treasureTarget?.let { message ->
        ChatTreasureDialog(
            conversationId = state.activeConversationId,
            message = message,
            voiceClips = voiceClips.filter {
                it.messageId == message.remoteVariantId ||
                    (message.replyGroupTail && it.messageId.isBlank() && it.turnId == message.turnId &&
                        message.role == MessageRole.Assistant)
            },
            repository = sideRooms,
            onDismiss = { treasureTarget = null },
            onSaved = {
                treasureTarget = null
                treasureRevision += 1
                onPlaceholder("拾潮收藏已保存；取消收藏不会删除原媒体。")
            }
        )
    }

    voiceTarget?.let { message ->
        VoiceSelectionDialog(
            message = message, working = voiceWorking, localMode=state.localMode,
            onDismiss = { voiceTarget = null },
            onGenerate = { indices ->
                val variantId = message.remoteVariantId
                if (variantId.isNullOrBlank()) {
                    onPlaceholder("这条消息尚未保存持久化版本。")
                } else {
                    voiceWorking = true
                    attachmentScope.launch {
                        try {
                            sideRooms.generateVoice(buildJsonObject {
                                put("conversation_id", state.activeConversationId)
                                put("message_id", variantId)
                                put("paragraph_indices", buildJsonArray { indices.forEach { add(JsonPrimitive(it)) } })
                            })
                            voiceClips = decodeVoiceClips(sideRooms.voiceClips(state.activeConversationId))
                            voiceTarget = null
                            onPlaceholder("声音已经留在这条消息里。")
                        } catch (error: Exception) {
                            onPlaceholder("生成失败：${error.message}")
                        } finally { voiceWorking = false }
                    }
                }
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
