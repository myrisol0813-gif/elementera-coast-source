package com.elementeracoast.app.feature.shell

import android.content.Context
import com.elementeracoast.app.BuildConfig
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.elementeracoast.app.core.auth.SessionRestoreResult
import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.core.local.SharedPreferencesLocalPersistence
import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.ConversationSummary
import com.elementeracoast.app.core.model.CrossWindowRequest
import com.elementeracoast.app.core.model.FeatureDestination
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.model.RoomType
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteModelCatalogResponse
import com.elementeracoast.app.core.remote.RemoteProfile
import com.elementeracoast.app.feature.chat.ChatBranchNavigator
import com.elementeracoast.app.feature.chat.ChatHistoryMutations
import com.elementeracoast.app.feature.chat.ChatProgress
import com.elementeracoast.app.feature.chat.ChatSyncMapper
import com.elementeracoast.app.feature.daily.DailyProfile
import com.elementeracoast.app.feature.daily.DailyRepository
import com.elementeracoast.app.feature.dogtalk.CrossWindowRepository
import com.elementeracoast.app.feature.dogtalk.CrossWindowUiState
import com.elementeracoast.app.feature.dogtalk.DogtalkRepository
import com.elementeracoast.app.feature.memory.MemoryRepository
import com.elementeracoast.app.feature.wolf.GlobalArchiveRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CoastShellViewModel(
    private val persistence: LocalPersistence,
    private val backend: CoastBackendGraph,
    private val workDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate
) : ViewModel() {
    private val _state = MutableStateFlow(CoastShellState())
    val state: StateFlow<CoastShellState> = _state.asStateFlow()
    private val _crossWindow = MutableStateFlow(CrossWindowUiState())
    val crossWindow: StateFlow<CrossWindowUiState> = _crossWindow.asStateFlow()

    val local = LocalFeatureServices(persistence)
    val daily: DailyRepository get() = backend.daily
    val memory: MemoryRepository get() = backend.memory
    val dogtalk: DogtalkRepository get() = backend.dogtalk
    val crossWindowRepository: CrossWindowRepository get() = backend.crossWindow
    val archive: GlobalArchiveRepository get() = backend.archive
    private var generationJob: Job? = null
    private var historyJob: Job? = null
    private var attachmentUploadsInFlight = 0
    private val soilJobs = mutableMapOf<String, Job>()

    init {
        syncAppearance()
        restoreSession()
    }

    fun setPassword(value: String) {
        _state.update { it.copy(password = value, authMessage = null) }
    }

    fun enterCoast() {
        val password = _state.value.password
        if (password.isBlank() || _state.value.authBusy) return

        if (sourcePreviewShellEnabled()) {
            if (password != BuildConfig.SOURCE_PREVIEW_PASSWORD_HINT) {
                _state.update {
                    it.copy(
                        authenticated = false,
                        authBusy = false,
                        authMessage = "访问密码不正确。",
                        backendOffline = true
                    )
                }
                return
            }
            _state.update {
                it.copy(
                    authenticated = true,
                    authBusy = false,
                    authMessage = null,
                    backendOffline = true,
                    password = "",
                    snackbarMessage = "source preview：当前仅用于查看空壳，未连接后端。"
                )
            }
            applyCachedBootstrap()
            return
        }

        viewModelScope.launch(workDispatcher) {
            _state.update { it.copy(authBusy = true, authMessage = null) }
            try {
                val session = backend.auth.login(password)
                _state.update {
                    it.copy(
                        authenticated = true,
                        authBusy = false,
                        authMessage = null,
                        sessionPersistence = if (session.expiresAtEpochSeconds == 0L) "until_logout" else "legacy_expiring",
                        sessionExpiresAtEpochSeconds = session.expiresAtEpochSeconds,
                        backendOffline = false,
                        password = ""
                    )
                }
                bootstrapAuthenticated()
            } catch (error: CoastApiException) {
                _state.update {
                    it.copy(
                        authenticated = false,
                        authBusy = false,
                        authMessage = error.message,
                        backendOffline = error.kind == CoastApiErrorKind.Network
                    )
                }
            }
        }
    }

    private fun sourcePreviewShellEnabled(): Boolean =
        BuildConfig.COAST_API_BASE_URL == "https://elementera-coast-source.invalid" &&
            BuildConfig.SOURCE_PREVIEW_PASSWORD_HINT.isNotBlank()

    fun logout() {
        stopGeneration()
        resetCrossWindow()
        historyJob?.cancel()
        soilJobs.values.forEach(Job::cancel)
        soilJobs.clear()
        viewModelScope.launch(workDispatcher) {
            backend.auth.logout()
            _state.update {
                CoastShellState(
                    authBusy = false,
                    theme = it.theme,
                    userBubbleHex = it.userBubbleHex,
                    accentHex = it.accentHex
                )
            }
        }
    }

    fun syncAppearance() {
        val appearance = local.wolf.state.value.appearance
        _state.update {
            it.copy(
                theme = appearance.theme,
                userBubbleHex = appearance.userBubbleHex,
                accentHex = appearance.accentHex
            )
        }
    }

    fun cycleTheme() {
        local.wolf.cycleTheme()
        syncAppearance()
    }

    fun openRoomType(roomType: RoomType) {
        stopGeneration()
        if (roomType != RoomType.Main) {
            openRoomLanding(roomType)
            return
        }
        val target = _state.value.conversations.firstOrNull { it.roomType == RoomType.Main }
        if (target == null) openRoomLanding(RoomType.Main) else selectConversation(target.id)
    }

    fun selectConversation(id: String) {
        stopGeneration()
        if (id != _state.value.activeConversationId) discardPendingAttachments()
        val conversation = _state.value.conversations.firstOrNull { it.id == id } ?: return
        activateCachedConversation(conversation)
        loadConversation(conversation)
    }

    fun newConversation() {
        stopGeneration()
        discardPendingAttachments()
        val roomType = _state.value.activeRoomType
        viewModelScope.launch(workDispatcher) {
            try {
                val created = backend.conversations.create(roomType, "新聊天")
                val empty = RemoteHistory(conversationId = created.id)
                backend.chat.cacheHistory(created.id, empty)
                _state.update {
                    it.copy(
                        conversations = listOf(created) + it.conversations.filterNot { row -> row.id == created.id },
                        backendOffline = false
                    )
                }
                activateCachedConversation(created)
            } catch (error: CoastApiException) {
                handleBackendError(error, "新建窗口失败")
            }
        }
    }

    fun renameConversation(id: String, rawTitle: String) {
        val clean = rawTitle.trim()
        if (clean.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val updated = backend.conversations.rename(id, clean)
                _state.update { state ->
                    state.copy(
                        conversations = state.conversations.map { if (it.id == id) updated else it },
                        backendOffline = false
                    )
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "窗口改名失败")
            }
        }
    }

    fun deleteConversation(id: String) {
        val target = _state.value.conversations.firstOrNull { it.id == id } ?: return
        if (target.id == _state.value.activeConversationId) stopGeneration()
        viewModelScope.launch(workDispatcher) {
            try {
                backend.conversations.delete(id)
                val remaining = _state.value.conversations.filterNot { it.id == id }
                _state.update { it.copy(conversations = remaining, backendOffline = false) }
                if (target.id != _state.value.activeConversationId) return@launch
                val replacement = remaining.firstOrNull { it.roomType == target.roomType }
                    ?: remaining.firstOrNull { it.roomType == RoomType.Main }
                    ?: remaining.firstOrNull()
                if (replacement == null) openRoomLanding(RoomType.Main) else {
                    activateCachedConversation(replacement)
                    loadConversation(replacement)
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "删除窗口失败")
            }
        }
    }

    fun openFeature(destination: FeatureDestination) {
        stopGeneration()
        _state.update {
            it.copy(
                activeFeature = destination,
                actionLogFocusIds = if (destination == FeatureDestination.ActionLog) emptySet() else it.actionLogFocusIds,
                showModelPicker = false
            )
        }
    }

    fun openActionLog(actionIds: Set<String>) {
        stopGeneration()
        _state.update {
            it.copy(
                activeFeature = FeatureDestination.ActionLog,
                actionLogFocusIds = actionIds,
                showModelPicker = false
            )
        }
    }

    fun backToChat() {
        _state.update { it.copy(activeFeature = null, actionLogFocusIds = emptySet()) }
    }

    fun openModelPicker() {
        if (_state.value.activeFeature == null) _state.update { it.copy(showModelPicker = true) }
    }

    fun dismissModelPicker() {
        _state.update { it.copy(showModelPicker = false) }
    }

    fun selectModel(model: String) {
        if (model !in _state.value.models || model == _state.value.currentModel) {
            _state.update { it.copy(showModelPicker = false) }
            return
        }
        viewModelScope.launch(workDispatcher) {
            try {
                val profile = backend.profile.setCurrentChatModel(model)
                _state.update {
                    it.copy(
                        currentModel = profile.currentChatModel.ifBlank { model },
                        showModelPicker = false,
                        backendOffline = false,
                        snackbarMessage = "当前模型已同步到后端"
                    )
                }
                logAction("model.switch", "切换模型", "当前：${model.substringAfterLast('/')}")
            } catch (error: CoastApiException) {
                handleBackendError(error, "模型切换失败")
            }
        }
    }

    fun refreshModels() {
        viewModelScope.launch(workDispatcher) {
            try {
                val catalog = backend.profile.refreshModels(force = true)
                applyModels(catalog)
                _state.update { it.copy(backendOffline = false, snackbarMessage = "模型目录已刷新") }
            } catch (error: CoastApiException) {
                handleBackendError(error, "模型目录刷新失败")
            }
        }
    }

    fun refreshCoastState() {
        if (!_state.value.authenticated || generationJob?.isActive == true || _state.value.isStreaming) return
        viewModelScope.launch(workDispatcher) {
            val remoteProfile = remoteOrNull("读取个人资料") { backend.profile.refreshProfile() }
            val remoteDaily = remoteOrNull("读取小组件") { backend.daily.refresh() }
            val remoteModels = remoteOrNull("读取模型目录") { backend.profile.refreshModels() }
            val remoteConversations = remoteOrNull("读取聊天窗口") { backend.conversations.refresh() }
            val memoryConversationId = _state.value.activeConversationId
            if (memoryConversationId.isNotBlank()) remoteOrNull("读取轨迹记忆") { backend.memory.refresh(memoryConversationId) }
            if (!_state.value.authenticated) return@launch

            applyProfile(
                remoteProfile ?: backend.profile.cachedProfile(),
                remoteDaily?.profile ?: backend.daily.cachedProfile()
            )
            applyModels(remoteModels ?: backend.profile.cachedModels())
            val list = remoteConversations ?: backend.conversations.cached()
            _state.update { it.copy(conversations = list, backendOffline = false) }
            val target = list.firstOrNull { it.id == _state.value.activeConversationId }
            if (target != null) loadConversation(target)
            _state.update { it.copy(snackbarMessage = "前端状态已刷新") }
        }
    }

    fun updateModelPartnerAvatar(dataUrl: String) {
        if (dataUrl.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val profile = backend.profile.setAssistantAvatar(dataUrl)
                applyProfile(profile, backend.daily.cachedProfile())
                _state.update { it.copy(backendOffline = false, snackbarMessage = "另一位屋主头像已写回后端") }
            } catch (error: CoastApiException) {
                handleBackendError(error, "另一位屋主头像更新失败")
            }
        }
    }

    fun importMessages(@Suppress("UNUSED_PARAMETER") messages: List<ChatMessage>) {
        showPlaceholder("聊天记录导入尚未接后端，本轮没有写入或替换真实会话。")
    }

    fun logLocalAction(actionKey: String, label: String, summary: String) {
        logAction(actionKey, label, summary)
    }

    fun updateCrossWindow(value: CrossWindowUiState) {
        _crossWindow.value = value
    }

    fun sendMessage(text: String) {
        val clean = text.trim()
        val pendingAttachments = _state.value.pendingAttachments
        if ((clean.isBlank() && pendingAttachments.isEmpty()) || generationJob?.isActive == true || _state.value.isStreaming || _state.value.attachmentUploading) return
        if (_state.value.currentModel.isBlank() && _state.value.activeRoomType != RoomType.Lighthouse) {
            showPlaceholder("当前模型还没有从后端载入，暂时不能发送。")
            return
        }
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                val conversation = ensureRemoteConversation()
                val conversationId = conversation.id
                if (_state.value.activeConversationId == conversationId) {
                    _state.update { it.copy(turnDeskReceipt = null) }
                }
                val baseHistory = historyForSend(conversationId)
                val appended = ChatSyncMapper.appendUser(baseHistory, clean, pendingAttachments)
                backend.chat.cacheHistory(conversationId, appended.history)
                showHistory(conversationId, appended.history)

                val persistedUser = try {
                    backend.chat.persistHistory(conversationId, appended.history)
                } catch (error: CoastApiException) {
                    val failed = backend.chat.failedHistory(
                        appended.history,
                        appended.turnId,
                        _state.value.currentModel,
                        error
                    )
                    backend.chat.cacheHistory(conversationId, failed)
                    showHistory(conversationId, failed)
                    handleBackendError(error, "消息发送失败", keepAuthenticatedOnNetworkError = true)
                    return@launch
                }

                _state.update { it.copy(pendingAttachments = emptyList(), attachmentUploading = false) }

                if (conversation.roomType == RoomType.Lighthouse) {
                    resetCrossWindow()
                    showHistory(conversationId, persistedUser)
                    _state.update { it.copy(snackbarMessage = "MCP 对话区已写入后端；这里按房间规则不触发模型回复") }
                    return@launch
                }
                generateTurn(
                    conversationId,
                    persistedUser,
                    appended.turnId,
                    _state.value.currentModel,
                    consumeCrossWindowRequest()
                )
            } catch (error: CoastApiException) {
                handleBackendError(error, "消息发送失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                generationJob = null
            }
        }
    }

    fun uploadAttachment(name: String, mime: String, bytes: ByteArray) {
        if (
            bytes.isEmpty() ||
            bytes.size > 8 * 1024 * 1024 ||
            _state.value.pendingAttachments.size + attachmentUploadsInFlight >= 12
        ) {
            _state.update {
                it.copy(snackbarMessage = when {
                    bytes.isEmpty() -> "附件是空文件。"
                    bytes.size > 8 * 1024 * 1024 -> "附件超过当前 8 MB 上传上限。"
                    else -> "一轮最多发送 12 个附件。"
                })
            }
            return
        }
        attachmentUploadsInFlight += 1
        _state.update { it.copy(attachmentUploading = true) }
        viewModelScope.launch(workDispatcher) {
            var conversationId = ""
            try {
                val conversation = ensureRemoteConversation()
                conversationId = conversation.id
                val remote = backend.chat.uploadAttachment(
                    conversationId = conversationId,
                    name = name,
                    mime = mime,
                    bytes = bytes
                )
                val attachment = ChatAttachment(
                    id = remote.id,
                    type = remote.type,
                    name = remote.name,
                    mime = remote.mime,
                    size = remote.size,
                    storageKey = remote.storageKey,
                    createdAt = remote.createdAt
                )
                if (_state.value.activeConversationId == conversationId) {
                    _state.update { state ->
                        state.copy(
                            pendingAttachments = (state.pendingAttachments + attachment)
                                .distinctBy { it.id }
                                .take(12),
                            backendOffline = false
                        )
                    }
                } else {
                    runCatching { backend.chat.deleteAttachment(conversationId, attachment.id) }
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "附件上传失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                attachmentUploadsInFlight = (attachmentUploadsInFlight - 1).coerceAtLeast(0)
                _state.update { it.copy(attachmentUploading = attachmentUploadsInFlight > 0) }
            }
        }
    }

    fun removePendingAttachment(attachmentId: String) {
        val id = attachmentId.trim()
        val conversationId = _state.value.activeConversationId
        if (id.isBlank() || conversationId.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                backend.chat.deleteAttachment(conversationId, id)
                _state.update { state ->
                    state.copy(pendingAttachments = state.pendingAttachments.filterNot { it.id == id })
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "附件移除失败", keepAuthenticatedOnNetworkError = true)
            }
        }
    }

    private fun discardPendingAttachments() {
        val conversationId = _state.value.activeConversationId
        val pending = _state.value.pendingAttachments
        if (pending.isEmpty()) return
        _state.update { it.copy(pendingAttachments = emptyList(), attachmentUploading = false) }
        if (conversationId.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            pending.forEach { attachment ->
                runCatching { backend.chat.deleteAttachment(conversationId, attachment.id) }
            }
        }
    }

    fun handleMessageAction(action: MessageAction) {
        val current = _state.value
        val message = current.messages.firstOrNull { it.id == action.messageId } ?: return
        when (action) {
            is MessageAction.Copy -> logAction(
                "message.copy",
                "复制消息",
                "${message.role.name.lowercase()} · ${message.text.length} 字"
            )
            is MessageAction.Retry -> retryMessage(message)
            is MessageAction.SelectVariant -> selectVariantForViewing(message, action.index)
            is MessageAction.ToggleLike -> mutateMessageHistory("点赞写回失败", "已同步点赞") { history ->
                ChatHistoryMutations.toggleActiveAssistantLike(history, message.turnId ?: return@mutateMessageHistory history)
            }
            is MessageAction.ToggleFavorite -> mutateMessageHistory("收藏写回失败", "已同步收藏") { history ->
                ChatHistoryMutations.toggleActiveAssistantFavorite(history, message.turnId ?: return@mutateMessageHistory history)
            }
            is MessageAction.Delete -> deleteMessage(message)
            is MessageAction.Edit -> editMessage(message, action.text)
            is MessageAction.Regenerate -> regenerateMessage(message)
        }
    }

    fun stopGeneration() {
        generationJob?.cancel()
        _state.update {
            it.copy(
                isStreaming = false,
                streamingMessageId = null,
                streamingVariantIndex = null
            )
        }
    }

    fun showPlaceholder(message: String) {
        _state.update { it.copy(snackbarMessage = message) }
    }

    fun clearSnackbar() {
        _state.update { it.copy(snackbarMessage = null) }
    }

    private fun restoreSession() {
        viewModelScope.launch(workDispatcher) {
            _state.update { it.copy(authBusy = true, authMessage = null) }
            when (val restored = backend.auth.restore()) {
                SessionRestoreResult.Missing -> _state.update {
                    it.copy(authenticated = false, authBusy = false, backendOffline = false)
                }
                is SessionRestoreResult.Invalid -> _state.update {
                    it.copy(
                        authenticated = false,
                        authBusy = false,
                        authMessage = restored.message,
                        backendOffline = false
                    )
                }
                is SessionRestoreResult.Restored -> {
                    _state.update {
                        it.copy(
                            authenticated = true,
                            authBusy = false,
                            authMessage = null,
                            sessionPersistence = if (restored.session.expiresAtEpochSeconds == 0L) "until_logout" else "legacy_expiring",
                            sessionExpiresAtEpochSeconds = restored.session.expiresAtEpochSeconds,
                            backendOffline = false
                        )
                    }
                    bootstrapAuthenticated()
                }
                is SessionRestoreResult.Offline -> {
                    _state.update {
                        it.copy(
                            authenticated = true,
                            authBusy = false,
                            authMessage = null,
                            sessionPersistence = if (restored.session.expiresAtEpochSeconds == 0L) "until_logout" else "legacy_expiring",
                            sessionExpiresAtEpochSeconds = restored.session.expiresAtEpochSeconds,
                            backendOffline = true,
                            snackbarMessage = "暂时无法验证登录态：${restored.message}；先使用本机缓存。"
                        )
                    }
                    applyCachedBootstrap()
                }
            }
        }
    }

    private suspend fun bootstrapAuthenticated() {
        applyCachedBootstrap()
        val remoteProfile = remoteOrNull("读取个人资料") { backend.profile.refreshProfile() }
        val remoteDaily = remoteOrNull("读取头像与封面") { backend.daily.refreshProfile() }
        val remoteModels = remoteOrNull("读取模型目录") { backend.profile.refreshModels() }
        val remoteConversations = remoteOrNull("读取聊天窗口") { backend.conversations.refresh() }
        if (!_state.value.authenticated) return

        applyProfile(remoteProfile ?: backend.profile.cachedProfile(), remoteDaily ?: backend.daily.cachedProfile())
        applyModels(remoteModels ?: backend.profile.cachedModels())
        val list = remoteConversations ?: backend.conversations.cached()
        _state.update { it.copy(conversations = list) }
        val remembered = persistence.get(KEY_CURRENT_CONVERSATION)
        val target = list.firstOrNull { it.id == _state.value.activeConversationId }
            ?: list.firstOrNull { it.id == remembered }
            ?: list.firstOrNull { it.roomType == RoomType.Main }
            ?: list.firstOrNull()
        if (target == null) {
            openRoomLanding(RoomType.Main)
        } else {
            activateCachedConversation(target)
            loadConversation(target)
        }
    }

    private fun applyCachedBootstrap() {
        val conversations = backend.conversations.cached()
        val profile = backend.profile.cachedProfile()
        val dailyProfile = backend.daily.cachedProfile()
        val models = backend.profile.cachedModels()
        val remembered = persistence.get(KEY_CURRENT_CONVERSATION)
        val target = conversations.firstOrNull { it.id == remembered }
            ?: conversations.firstOrNull { it.roomType == RoomType.Main }
            ?: conversations.firstOrNull()
        val history = target?.let { backend.chat.cachedHistory(it.id) }
        _state.update {
            it.copy(
                conversations = conversations,
                activeRoomType = target?.roomType ?: RoomType.Main,
                activeConversationId = target?.id.orEmpty(),
                messages = history?.let(ChatSyncMapper::toUi).orEmpty(),
                thoughtSoil = null,
                turnDeskReceipt = null
            )
        }
        applyProfile(profile, dailyProfile)
        applyModels(models)
    }

    private fun applyProfile(profile: RemoteProfile?, daily: DailyProfile) {
        val current = profile?.currentChatModel.orEmpty()
        val myri = profile?.assistantAvatarDataUrl.orEmpty().ifBlank { daily.myriAvatarDataUrl }
        _state.update {
            it.copy(
                currentModel = current.ifBlank { it.currentModel },
                myriAvatarDataUrl = myri,
                xiaohanAvatarDataUrl = daily.xiaohanAvatarDataUrl,
                coverDataUrl = daily.momentCoverDataUrl
            )
        }
    }

    private fun applyModels(catalog: RemoteModelCatalogResponse?) {
        if (catalog == null) return
        val models = buildList {
            addAll(catalog.groups.openAiChat.map { it.id })
            addAll(catalog.groups.freeTest.map { it.id })
            addAll(catalog.groups.openAiImage.map { it.id })
        }.filter(String::isNotBlank).distinct()
        val current = _state.value.currentModel
        _state.update {
            it.copy(
                models = if (current.isNotBlank() && current !in models) listOf(current) + models else models,
                currentModel = current.ifBlank { models.firstOrNull().orEmpty() }
            )
        }
    }

    private fun loadConversation(conversation: ConversationSummary) {
        historyJob?.cancel()
        val cached = backend.chat.cachedHistory(conversation.id)
        if (cached != null) showHistory(conversation.id, cached)
        loadThoughtSoil(conversation.id)
        historyJob = viewModelScope.launch(workDispatcher) {
            _state.update { it.copy(historyLoading = true) }
            try {
                val history = backend.chat.loadHistory(conversation.id)
                showHistory(conversation.id, history)
                _state.update { it.copy(historyLoading = false, backendOffline = false) }
            } catch (error: CoastApiException) {
                _state.update { it.copy(historyLoading = false) }
                handleBackendError(error, "聊天记录载入失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                historyJob = null
            }
        }
    }

    private fun loadThoughtSoil(conversationId: String) {
        viewModelScope.launch(workDispatcher) {
            try {
                val soil = backend.thoughtSoil.load(conversationId)
                if (_state.value.activeConversationId == conversationId) {
                    _state.update { it.copy(thoughtSoil = soil) }
                }
            } catch (error: CoastApiException) {
                if (error.kind == CoastApiErrorKind.Unauthorized) {
                    handleBackendError(error, "整理当前对话的纸条载入失败", keepAuthenticatedOnNetworkError = true)
                }
            }
        }
    }

    private fun organizeThoughtSoilAfterReply(conversationId: String, modelId: String) {
        val previous = soilJobs[conversationId]
        val job = viewModelScope.launch(workDispatcher) {
            previous?.join()
            try {
                val soil = backend.thoughtSoil.organizeAfterReply(conversationId, modelId)
                if (_state.value.activeConversationId == conversationId) {
                    _state.update { it.copy(thoughtSoil = soil) }
                }
            } catch (error: CoastApiException) {
                if (error.kind == CoastApiErrorKind.Unauthorized) {
                    handleBackendError(error, "整理当前对话的纸条整理失败", keepAuthenticatedOnNetworkError = true)
                }
            }
        }
        soilJobs[conversationId] = job
        job.invokeOnCompletion {
            if (soilJobs[conversationId] === job) soilJobs.remove(conversationId)
        }
    }

    private suspend fun ensureRemoteConversation(): ConversationSummary {
        val current = _state.value
        current.conversations.firstOrNull { it.id == current.activeConversationId }?.let { return it }
        val created = backend.conversations.create(current.activeRoomType, "新聊天")
        val empty = RemoteHistory(conversationId = created.id)
        backend.chat.cacheHistory(created.id, empty)
        persistence.put(KEY_CURRENT_CONVERSATION, created.id)
        _state.update {
            it.copy(
                conversations = listOf(created) + it.conversations.filterNot { row -> row.id == created.id },
                activeConversationId = created.id,
                activeRoomType = created.roomType,
                messages = emptyList(),
                thoughtSoil = null,
                turnDeskReceipt = null,
                backendOffline = false
            )
        }
        return created
    }

    private suspend fun historyForSend(conversationId: String): RemoteHistory {
        backend.chat.cachedHistory(conversationId)?.let { return it }
        return backend.chat.loadHistory(conversationId)
    }

    private suspend fun generateTurn(
        conversationId: String,
        history: RemoteHistory,
        turnId: String,
        modelId: String,
        crossWindowRequest: CrossWindowRequest
    ) {
        var partial = ""
        val cleared = backend.chat.clearFailure(history, turnId)
        val titleUserText = ChatSyncMapper.contextMessages(cleared, turnId, local.wolf.state.value.basic.recentTurns)
            .lastOrNull { it.role == "user" }
            ?.content
            .orEmpty()
        backend.chat.cacheHistory(conversationId, cleared)
        val streamingId = ChatSyncMapper.streamingMessageId(turnId)
        showStreaming(conversationId, cleared, turnId, modelId, partial)
        _state.update {
            it.copy(
                isStreaming = true,
                streamingMessageId = streamingId,
                streamingVariantIndex = null,
                turnDeskReceipt = null
            )
        }
        try {
            backend.chat.streamReply(
                conversationId,
                cleared,
                turnId,
                modelId,
                local.wolf.state.value.basic.recentTurns,
                local.wolf.state.value.basic.contextBudget,
                crossWindowRequest
            ).collect { progress ->
                when (progress) {
                    is ChatProgress.Delta -> {
                        partial += progress.text
                        showStreaming(conversationId, cleared, turnId, modelId, partial)
                    }
                    is ChatProgress.Completed -> {
                        showHistory(conversationId, progress.history)
                        if (_state.value.activeConversationId == conversationId) {
                            _state.update {
                                it.copy(
                                    backendOffline = false,
                                    turnDeskReceipt = progress.deskReceipt
                                )
                            }
                        }
                        refreshGeneratedTitle(conversationId, titleUserText, partial)
                        organizeThoughtSoilAfterReply(conversationId, progress.modelId)
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            val stopped = backend.chat.cancelledHistory(cleared, turnId, modelId, partial)
            backend.chat.cacheHistory(conversationId, stopped)
            withContext(NonCancellable) {
                runCatching { backend.chat.persistHistory(conversationId, stopped) }
            }
            showHistory(conversationId, stopped)
            _state.update { it.copy(snackbarMessage = "已停止生成") }
            throw cancelled
        } catch (error: CoastApiException) {
            val failed = backend.chat.failedHistory(cleared, turnId, modelId, error, partial)
            backend.chat.cacheHistory(conversationId, failed)
            withContext(NonCancellable) {
                runCatching { backend.chat.persistHistory(conversationId, failed) }
            }
            showHistory(conversationId, failed)
            handleBackendError(error, "模型回复失败", keepAuthenticatedOnNetworkError = true)
        } finally {
            if (_state.value.streamingMessageId == streamingId) {
                _state.update {
                    it.copy(
                        isStreaming = false,
                        streamingMessageId = null,
                        streamingVariantIndex = null
                    )
                }
            }
        }
    }

    private suspend fun refreshGeneratedTitle(conversationId: String, user: String, assistant: String) {
        if (user.isBlank() || assistant.isBlank()) return
        try {
            val titled = backend.conversations.generateTitle(conversationId, user, assistant) ?: return
            _state.update { state ->
                state.copy(
                    conversations = state.conversations.map { if (it.id == conversationId) titled else it }
                )
            }
        } catch (error: CoastApiException) {
            if (error.kind == CoastApiErrorKind.Unauthorized) {
                handleBackendError(error, "窗口自动命名失败", keepAuthenticatedOnNetworkError = true)
            }
        }
    }

    private fun retryMessage(message: ChatMessage) {
        val turnId = message.turnId ?: return
        val conversationId = _state.value.activeConversationId
        if (message.role != MessageRole.User || conversationId.isBlank() || generationJob?.isActive == true) return
        val history = backend.chat.cachedHistory(conversationId) ?: run {
            showPlaceholder("没有可重试的本机历史缓存，请先重新打开这个窗口。")
            return
        }
        val model = _state.value.currentModel
        if (model.isBlank()) {
            showPlaceholder("当前模型还没有从后端载入，暂时不能重试。")
            return
        }
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                val cleared = backend.chat.clearFailure(history, turnId)
                val persisted = backend.chat.persistHistory(conversationId, cleared)
                showHistory(conversationId, persisted)
                generateTurn(conversationId, persisted, turnId, model, consumeCrossWindowRequest())
            } catch (error: CoastApiException) {
                val failed = backend.chat.failedHistory(history, turnId, model, error)
                backend.chat.cacheHistory(conversationId, failed)
                showHistory(conversationId, failed)
                handleBackendError(error, "重试失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                generationJob = null
            }
        }
    }

    private fun selectVariantForViewing(message: ChatMessage, index: Int) {
        val turnId = message.turnId ?: return
        mutateMessageHistory("版本切换写回失败", "已同步当前版本") { history ->
            ChatBranchNavigator.select(history, turnId, message.role, index)
        }
    }

    private fun deleteMessage(message: ChatMessage) {
        val turnId = message.turnId ?: return
        mutateMessageHistory("删除消息失败", "消息已删除") { history ->
            when (message.role) {
                MessageRole.User -> ChatHistoryMutations.deleteActiveUser(history, turnId)
                MessageRole.Assistant -> ChatHistoryMutations.deleteActiveAssistant(history, turnId)
            }
        }
    }

    private fun editMessage(message: ChatMessage, rawText: String) {
        val turnId = message.turnId ?: return
        val clean = rawText.trim()
        if (message.role != MessageRole.User || clean.isBlank()) return
        if (_state.value.isStreaming || generationJob?.isActive == true) {
            showPlaceholder("当前回复仍在生成，完成后再编辑消息。")
            return
        }
        val conversationId = _state.value.activeConversationId
        if (conversationId.isBlank()) return
        val previous = backend.chat.cachedHistory(conversationId) ?: run {
            showPlaceholder("聊天记录尚未载入完成，请重新打开窗口后再编辑。")
            return
        }
        val edited = ChatHistoryMutations.editActiveUser(previous, turnId, clean)
        if (edited == previous) return
        backend.chat.cacheHistory(conversationId, edited)
        showHistory(conversationId, edited)

        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                val persisted = backend.chat.persistHistory(conversationId, edited)
                showHistory(conversationId, persisted)
                val conversation = _state.value.conversations.firstOrNull { it.id == conversationId }
                if (conversation?.roomType == RoomType.Lighthouse) {
                    _state.update { it.copy(snackbarMessage = "编辑版本已写回后端") }
                    return@launch
                }
                val model = _state.value.currentModel
                if (model.isBlank()) {
                    _state.update { it.copy(snackbarMessage = "编辑版本已写回；当前没有可用聊天模型，未生成新回复") }
                    return@launch
                }
                generateTurn(conversationId, persisted, turnId, model, consumeCrossWindowRequest())
            } catch (error: CoastApiException) {
                backend.chat.cacheHistory(conversationId, previous)
                showHistory(conversationId, previous)
                handleBackendError(error, "编辑消息失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                generationJob = null
            }
        }
    }

    private fun regenerateMessage(message: ChatMessage) {
        val turnId = message.turnId ?: return
        if (message.role != MessageRole.Assistant) return
        if (_state.value.isStreaming || generationJob?.isActive == true) {
            showPlaceholder("当前回复仍在生成，完成后再重新生成。")
            return
        }
        val conversationId = _state.value.activeConversationId
        if (conversationId.isBlank()) return
        val conversation = _state.value.conversations.firstOrNull { it.id == conversationId }
        if (conversation?.roomType == RoomType.Lighthouse) {
            showPlaceholder("MCP 对话区只保存文字，不触发模型重刷。")
            return
        }
        val history = backend.chat.cachedHistory(conversationId) ?: run {
            showPlaceholder("聊天记录尚未载入完成，请重新打开窗口后再重刷。")
            return
        }
        val model = _state.value.currentModel
        if (model.isBlank()) {
            showPlaceholder("当前模型还没有从后端载入，暂时不能重新生成。")
            return
        }
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                generateTurn(conversationId, history, turnId, model, consumeCrossWindowRequest())
            } finally {
                generationJob = null
            }
        }
    }

    private fun mutateMessageHistory(
        failureLabel: String,
        successMessage: String,
        transform: (RemoteHistory) -> RemoteHistory
    ) {
        if (_state.value.isStreaming || generationJob?.isActive == true) {
            showPlaceholder("当前回复仍在生成，完成后再修改消息。")
            return
        }
        val conversationId = _state.value.activeConversationId
        if (conversationId.isBlank()) return
        val previous = backend.chat.cachedHistory(conversationId) ?: run {
            showPlaceholder("聊天记录尚未载入完成，请重新打开窗口后再修改。")
            return
        }
        val next = transform(previous)
        if (next == previous) return
        backend.chat.cacheHistory(conversationId, next)
        showHistory(conversationId, next)
        viewModelScope.launch(workDispatcher) {
            try {
                val persisted = backend.chat.persistHistory(conversationId, next)
                showHistory(conversationId, persisted)
                _state.update { it.copy(backendOffline = false, snackbarMessage = successMessage) }
            } catch (error: CoastApiException) {
                backend.chat.cacheHistory(conversationId, previous)
                showHistory(conversationId, previous)
                handleBackendError(error, failureLabel, keepAuthenticatedOnNetworkError = true)
            }
        }
    }

    private fun showStreaming(
        conversationId: String,
        history: RemoteHistory,
        turnId: String,
        modelId: String,
        partial: String
    ) {
        if (_state.value.activeConversationId != conversationId) return
        val messages = ChatSyncMapper.toUi(history) + ChatSyncMapper.streamingAssistant(turnId, modelId, partial)
        _state.update { it.copy(messages = messages) }
    }

    private fun showHistory(conversationId: String, history: RemoteHistory) {
        if (_state.value.activeConversationId != conversationId) return
        _state.update { it.copy(messages = ChatSyncMapper.toUi(history)) }
    }

    private fun activateCachedConversation(conversation: ConversationSummary) {
        resetCrossWindow()
        persistence.put(KEY_CURRENT_CONVERSATION, conversation.id)
        val history = backend.chat.cachedHistory(conversation.id)
        _state.update {
            it.copy(
                activeRoomType = conversation.roomType,
                activeFeature = null,
                actionLogFocusIds = emptySet(),
                activeConversationId = conversation.id,
                messages = history?.let(ChatSyncMapper::toUi).orEmpty(),
                thoughtSoil = null,
                turnDeskReceipt = null,
                showModelPicker = false,
                isStreaming = false,
                streamingMessageId = null,
                streamingVariantIndex = null
            )
        }
    }

    private fun openRoomLanding(roomType: RoomType) {
        require(roomType in RoomType.entries)
        resetCrossWindow()
        persistence.remove(KEY_CURRENT_CONVERSATION)
        _state.update {
            it.copy(
                activeRoomType = roomType,
                activeFeature = null,
                actionLogFocusIds = emptySet(),
                activeConversationId = "",
                messages = emptyList(),
                thoughtSoil = null,
                turnDeskReceipt = null,
                showModelPicker = false,
                historyLoading = false,
                isStreaming = false,
                streamingMessageId = null,
                streamingVariantIndex = null
            )
        }
    }

    private fun consumeCrossWindowRequest(): CrossWindowRequest {
        val request = _crossWindow.value.request()
        _crossWindow.value = CrossWindowUiState()
        return request
    }

    private fun resetCrossWindow() {
        _crossWindow.value = CrossWindowUiState()
    }

    private suspend fun <T> remoteOrNull(label: String, block: suspend () -> T): T? = try {
        block()
    } catch (error: CoastApiException) {
        handleBackendError(error, "${label}失败", keepAuthenticatedOnNetworkError = true)
        null
    }

    private fun handleBackendError(
        error: CoastApiException,
        prefix: String,
        keepAuthenticatedOnNetworkError: Boolean = false
    ) {
        if (error.kind == CoastApiErrorKind.Unauthorized) {
            backend.auth.clearConfirmedInvalidSession()
            generationJob?.cancel()
            historyJob?.cancel()
            soilJobs.values.forEach(Job::cancel)
            soilJobs.clear()
            _state.update {
                it.copy(
                    authenticated = false,
                    authBusy = false,
                    authMessage = "登录状态已失效，请重新输入访问密码。",
                    backendOffline = false,
                    thoughtSoil = null,
                    turnDeskReceipt = null,
                    isStreaming = false,
                    streamingMessageId = null,
                    streamingVariantIndex = null
                )
            }
            return
        }
        _state.update {
            it.copy(
                backendOffline = if (error.kind == CoastApiErrorKind.Network) true else it.backendOffline,
                snackbarMessage = "$prefix：${error.message}",
                authenticated = if (error.kind == CoastApiErrorKind.Network && keepAuthenticatedOnNetworkError) it.authenticated else it.authenticated
            )
        }
    }

    private fun logAction(
        actionKey: String,
        label: String,
        output: String,
        assistantMessageId: Long? = null
    ) {
        val current = _state.value
        if (current.activeConversationId.isBlank()) return
        local.actionLog.record(
            actionKey = actionKey,
            label = label,
            roomType = current.activeRoomType,
            conversationId = current.activeConversationId,
            outputSummary = output,
            assistantMessageId = assistantMessageId
        )
    }

    companion object {
        private const val KEY_CURRENT_CONVERSATION = "remote.current-conversation.v1"

        fun factory(context: Context): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                val appContext = context.applicationContext
                val persistence = SharedPreferencesLocalPersistence(appContext)
                val backend = CoastBackendGraph.production(appContext, persistence)
                return CoastShellViewModel(persistence, backend) as T
            }
        }
    }
}
