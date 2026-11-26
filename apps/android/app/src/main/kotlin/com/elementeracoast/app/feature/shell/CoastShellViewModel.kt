package com.elementeracoast.app.feature.shell

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.elementeracoast.app.core.auth.SessionRestoreResult
import com.elementeracoast.app.core.tour.SourceVisitGate
import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.core.local.NativeWorkspace
import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.ChatSearchFocus
import com.elementeracoast.app.core.model.ChatSearchHit
import com.elementeracoast.app.core.model.previewSearchVariant
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.ConversationSummary
import com.elementeracoast.app.core.model.ConversationContextSettings
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
import com.elementeracoast.app.feature.chat.ReplySequence
import com.elementeracoast.app.core.network.ReplyRunEvent
import com.elementeracoast.app.core.network.RemoteReplyRunRequest
import com.elementeracoast.app.core.network.RemoteReplyRunBudget
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import com.elementeracoast.app.feature.chat.ChatSyncMapper
import com.elementeracoast.app.feature.chat.CHATGPT_PLAN_PREFIX
import com.elementeracoast.app.feature.chat.isChatGptPlanModel
import com.elementeracoast.app.feature.chatgpt.ChatGptConnectState
import com.elementeracoast.app.feature.chatgpt.ChatGptPlanRepository
import com.elementeracoast.app.feature.chatgpt.ChatGptSecureStore
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
    private val workDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    private val chatGpt: ChatGptPlanRepository? = null,
    private val localMode: Boolean = false,
    private val foregroundLease: ((()->Unit,()->Unit)->AutoCloseable?)? = null
) : ViewModel() {
    private val _state = MutableStateFlow(CoastShellState(
        currentModel = chatGpt?.preferredModel()?.let { CHATGPT_PLAN_PREFIX + it }.orEmpty(),
        localMode = localMode
    ))
    val state: StateFlow<CoastShellState> = _state.asStateFlow()
    private val _crossWindow = MutableStateFlow(CrossWindowUiState())
    val crossWindow: StateFlow<CrossWindowUiState> = _crossWindow.asStateFlow()

    val local = LocalFeatureServices(persistence)
    private val _chatGptState = MutableStateFlow(
        ChatGptConnectState(
            connected = chatGpt?.currentAccount() != null,
            accountLabel = chatGpt?.currentAccount()?.email.orEmpty()
                .ifBlank { "已保存的 ChatGPT 账户" }
        )
    )
    val chatGptState: StateFlow<ChatGptConnectState> = _chatGptState.asStateFlow()
    val daily: DailyRepository get() = backend.daily
    val memory: MemoryRepository get() = backend.memory
    val dogtalk: DogtalkRepository get() = backend.dogtalk
    val crossWindowRepository: CrossWindowRepository get() = backend.crossWindow
    val archive: GlobalArchiveRepository get() = backend.archive
    private var generationJob: Job? = null
    private class GenerationRun(var ownerId: String) {
        var lease: AutoCloseable? = null
        var preparing = true
        var streaming = false
        var messageId: Long? = null
        var preview: List<ChatMessage>? = null
    }
    private var generationRun: GenerationRun? = null

    private fun generationUi(state: CoastShellState): CoastShellState {
        val run = generationRun
        val visible = run != null && run.ownerId == state.activeConversationId && state.activeFeature == null
        val streaming = visible && run?.streaming == true
        return state.copy(
            isStreaming = streaming,
            isFinalizing = run != null && !streaming,
            backgroundGeneration = run != null && !visible,
            streamingMessageId = if (streaming) run?.messageId else null,
            streamingVariantIndex = null
        )
    }

    private fun beginGeneration(ownerId: String) {
        check(generationRun == null)
        historyJob?.cancel()
        val run = GenerationRun(ownerId)
        generationRun = run
        _state.update { generationUi(it.copy(historyLoading = false)) }
        run.lease = foregroundLease?.invoke({ if (generationRun === run) generationJob?.cancel() }, {
            if (generationRun === run) showPlaceholder("系统后台保护不可用；本轮仍可在应用内继续，切出应用可能中断。")
        })
    }

    private fun finishGeneration() {
        generationRun?.lease?.close()
        generationRun = null
        generationJob = null
        _state.update(::generationUi)
    }

    private fun canNavigateDuringGeneration(): Boolean {
        if (generationRun?.preparing != true) return true
        showPlaceholder("正在保存本轮消息，保存后可以离开窗口。")
        return false
    }
    private var historyJob: Job? = null
    private var pendingSearchHit: ChatSearchHit? = null
    private var searchNavigationId = 0L
    private var attachmentUploadsInFlight = 0

    init {
        syncAppearance()
        if (localMode) {
            _state.update { it.copy(authenticated = true, authBusy = false, sessionPersistence = "local") }
            viewModelScope.launch(workDispatcher) { bootstrapAuthenticated() }
        } else restoreSession()
    }

    fun setPassword(value: String) {
        _state.update { it.copy(password = value, authMessage = null) }
    }

    fun enterCoast() {
        val password = _state.value.password
        if (password.isBlank() || _state.value.authBusy) return
        // A public, non-authenticated doorway into the existing UI. Never call login/bootstrap.
        if (SourceVisitGate.open(password)) {
            _state.update {
                CoastShellState(
                    authenticated = true,
                    authBusy = false,
                    backendOffline = true,
                    sessionPersistence = SourceVisitGate.SESSION_KIND,
                    theme = it.theme,
                    userBubbleHex = it.userBubbleHex,
                    accentHex = it.accentHex,
                    snackbarMessage = "已进入参观模式：可浏览所有页面与本机外观；云端功能不连接。"
                )
            }
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

    fun logout() {
        generationJob?.cancel()
        resetCrossWindow()
        historyJob?.cancel()
        if (SourceVisitGate.isActive) {
            SourceVisitGate.leave()
            _state.update {
                CoastShellState(
                    theme = it.theme,
                    userBubbleHex = it.userBubbleHex,
                    accentHex = it.accentHex
                )
            }
            return
        }
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
        if (!canNavigateDuringGeneration()) return
        if (roomType != RoomType.Main) {
            openRoomLanding(roomType)
            return
        }
        val target = _state.value.conversations.firstOrNull { it.roomType == RoomType.Main }
        if (target == null) openRoomLanding(RoomType.Main) else selectConversation(target.id)
    }

    fun selectConversation(id: String) = selectConversationInternal(id, null)

    fun openSearchHit(hit: ChatSearchHit) {
        if (hit.kind == "conversation") {
            selectConversation(hit.conversationId)
            return
        }
        if (hit.kind != "message" || hit.messageId.isBlank() || hit.turnId.isBlank()) return
        selectConversationInternal(hit.conversationId, hit)
    }

    private fun selectConversationInternal(id: String, hit: ChatSearchHit?) {
        val conversation = _state.value.conversations.firstOrNull { it.id == id }
        if (conversation == null) {
            showPlaceholder("搜索结果的原窗口已不存在。")
            return
        }
        if (!canNavigateDuringGeneration()) return
        if (id != _state.value.activeConversationId) discardPendingAttachments()
        pendingSearchHit = hit
        searchNavigationId += 1
        activateCachedConversation(conversation)
        loadConversation(conversation)
    }

    fun newConversation() {
        if (tourBlocksCloudAction()) return
        if (!canNavigateDuringGeneration()) return
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
        if (tourBlocksCloudAction()) return
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
        if (tourBlocksCloudAction()) return
        val target = _state.value.conversations.firstOrNull { it.id == id } ?: return
        if (generationRun?.ownerId == id || generationRun?.preparing == true) {
            showPlaceholder("这个窗口仍有未结束的生成任务，请先停止或等待完成。")
            return
        }
        viewModelScope.launch(workDispatcher) {
            try {
                backend.conversations.delete(id)
                try { persistence.remove(composerDraftKey(id, target.roomType)) }
                catch (_: Exception) { _state.update { it.copy(snackbarMessage = "窗口已删除，但未能清除本机输入草稿。") } }
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
        if (!canNavigateDuringGeneration()) return
        _state.update {
            generationUi(it.copy(
                activeFeature = destination,
                actionLogFocusIds = if (destination == FeatureDestination.ActionLog) emptySet() else it.actionLogFocusIds,
                showModelPicker = false
            ))
        }
    }

    fun openActionLog(actionIds: Set<String>) {
        if (!canNavigateDuringGeneration()) return
        _state.update {
            generationUi(it.copy(
                activeFeature = FeatureDestination.ActionLog,
                actionLogFocusIds = actionIds,
                showModelPicker = false
            ))
        }
    }

    fun backToChat() {
        _state.update { generationUi(it.copy(activeFeature = null, actionLogFocusIds = emptySet())) }
    }

    fun openModelPicker() {
        if (_state.value.activeFeature == null) _state.update { it.copy(showModelPicker = true) }
    }

    fun dismissModelPicker() {
        _state.update { it.copy(showModelPicker = false) }
    }

    fun selectImageModel(model: String) {
        if (generationJob?.isActive == true || _state.value.isStreaming || _state.value.isFinalizing) {
            _state.update { it.copy(snackbarMessage = "当前对话还未结束，请稍后切换生图模型。") }
            return
        }
        if (model !in _state.value.imageModels || model == _state.value.currentImageModel) return
        viewModelScope.launch(workDispatcher) {
            try {
                val profile = backend.profile.setCurrentImageModel(model)
                _state.update { it.copy(currentImageModel = profile.currentImageModel, snackbarMessage = "生图模型已选定；按所选 API 正常计费。") }
            } catch (error: CoastApiException) { handleBackendError(error, "生图模型切换失败") }
        }
    }

    fun selectModel(model: String) {
        if (tourBlocksCloudAction()) return
        if (generationJob?.isActive == true || _state.value.isStreaming || _state.value.isFinalizing) {
            _state.update { it.copy(snackbarMessage = "当前对话还未结束，请稍后切换模型。") }
            return
        }
        if (isChatGptPlanModel(model)) {
            val slug = model.removePrefix(CHATGPT_PLAN_PREFIX)
            if (_chatGptState.value.connected && _chatGptState.value.availableModels.any { it.slug == slug }) {
                chatGpt?.selectModel(slug)
                _state.update {
                    it.copy(
                        currentModel = model,
                        showModelPicker = false,
                        snackbarMessage = "已切换 ChatGPT 套餐模型；推理额度由本机已授权账户提供。"
                    )
                }
            } else {
                _state.update { it.copy(snackbarMessage = "请先刷新 ChatGPT 模型目录，确认该模型可用。") }
            }
            return
        }
        if (model !in _state.value.models || model == _state.value.currentModel) {
            _state.update { it.copy(showModelPicker = false) }
            return
        }
        viewModelScope.launch(workDispatcher) {
            try {
                val profile = backend.profile.setCurrentChatModel(model)
                chatGpt?.selectModel(null)
                _state.update {
                    it.copy(
                        currentModel = profile.currentChatModel.ifBlank { model },
                        showModelPicker = false,
                        backendOffline = false,
                        snackbarMessage = if (localMode) "当前模型已保存在本机" else "当前模型已同步到后端"
                    )
                }
                logAction("model.switch", "切换模型", "当前：${model.substringAfterLast('/')}")
            } catch (error: CoastApiException) {
                handleBackendError(error, "模型切换失败")
            }
        }
    }

    fun connectChatGpt(openBrowser: (String) -> Unit) {
        if (tourBlocksCloudAction()) return
        val client = chatGpt ?: return
        if (_chatGptState.value.busy) return
        viewModelScope.launch(workDispatcher) {
            _chatGptState.update { it.copy(busy = true, message = "", probe = null) }
            try {
                val account = client.connect(openBrowser)
                _chatGptState.update {
                    it.copy(
                        connected = true,
                        accountLabel = account.email.ifBlank { "已验证的 ChatGPT 账户" },
                        message = "授权成功，正在读取可用模型。"
                    )
                }
                val models = client.models()
                _chatGptState.update {
                    it.copy(
                        availableModels = models,
                        message = if (models.isEmpty()) "授权成功，但本账户暂时没有返回可显示模型。"
                        else "已读取 ${models.size} 个账户可用模型。"
                    )
                }
            } catch (error: Exception) {
                _chatGptState.update {
                    it.copy(
                        connected = client.currentAccount() != null,
                        accountLabel = client.currentAccount()?.email.orEmpty(),
                        message = safeChatGptError(error)
                    )
                }
            } finally {
                _chatGptState.update { it.copy(busy = false) }
            }
        }
    }

    fun refreshChatGptModels() {
        if (tourBlocksCloudAction()) return
        val client = chatGpt ?: return
        if (_chatGptState.value.busy) return
        viewModelScope.launch(workDispatcher) {
            _chatGptState.update { it.copy(busy = true, message = "") }
            try {
                val models = client.models()
                _chatGptState.update {
                    it.copy(availableModels = models, message = "模型目录刷新完成：${models.size} 项。")
                }
            } catch (error: Exception) {
                _chatGptState.update { it.copy(message = safeChatGptError(error)) }
            } finally {
                _chatGptState.update { it.copy(busy = false) }
            }
        }
    }

    fun probeChatGpt(model: String) {
        if (tourBlocksCloudAction()) return
        val client = chatGpt ?: return
        if (_chatGptState.value.busy || _chatGptState.value.availableModels.none { it.slug == model }) return
        viewModelScope.launch(workDispatcher) {
            _chatGptState.update { it.copy(busy = true, probe = null, message = "正在验证真实模型回复。") }
            try {
                val probe = client.probe(model)
                _chatGptState.update { it.copy(probe = probe, message = "独立本机测试已完成；未写入聊天历史。") }
            } catch (error: Exception) {
                _chatGptState.update { it.copy(message = safeChatGptError(error)) }
            } finally {
                _chatGptState.update { it.copy(busy = false) }
            }
        }
    }

    fun disconnectChatGpt() {
        if (tourBlocksCloudAction()) return
        val client = chatGpt ?: return
        if (_chatGptState.value.busy) return
        viewModelScope.launch(workDispatcher) {
            _chatGptState.update { it.copy(busy = true) }
            try {
                val revoked = client.disconnect()
                if (isChatGptPlanModel(_state.value.currentModel)) {
                    _state.update { it.copy(currentModel = backend.profile.cachedProfile()?.currentChatModel.orEmpty()) }
                }
                _chatGptState.value = ChatGptConnectState(
                    message = if (revoked) "已断开 ChatGPT，授权已撤销。"
                    else "本机授权已清除；远端撤销未确认，可在 ChatGPT 设置中解除应用授权。"
                )
            } catch (_: Exception) {
                _chatGptState.value = ChatGptConnectState(message = "断开操作未完成，请重试。")
            }
        }
    }

    private fun safeChatGptError(error: Exception): String {
        val message = error.message.orEmpty()
        val allowed = listOf("ChatGPT", "GPT", "模型", "当前账户", "未批准", "请先", "Missing", "Unexpected")
        return if (allowed.any(message::startsWith)) message.take(150)
        else "ChatGPT 连接或请求未完成，请检查网络和账户授权。"
    }

    fun refreshModels() {
        if (tourBlocksCloudAction()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val catalog = backend.profile.refreshModels(force = true)
                applyModels(catalog)
                _state.update { it.copy(backendOffline = false, snackbarMessage = if (localMode) "本机模型目录已刷新" else "模型目录已刷新") }
            } catch (error: CoastApiException) {
                handleBackendError(error, "模型目录刷新失败")
            }
        }
    }

    fun refreshCoastState() {
        if (tourBlocksCloudAction()) return
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
        if (tourBlocksCloudAction()) return
        if (dataUrl.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val profile = backend.profile.setAssistantAvatar(dataUrl)
                applyProfile(profile, backend.daily.cachedProfile())
                _state.update { it.copy(backendOffline = false, snackbarMessage = "模型伙伴头像已写回后端") }
            } catch (error: CoastApiException) {
                handleBackendError(error, "模型伙伴头像更新失败")
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

    private fun composerDraftKey(id: String, room: RoomType): String =
        if (id.isBlank()) "chat.composer.draft.v1.landing.${room.wireValue}" else "chat.composer.draft.v1.window.$id"

    private fun readComposerDraft(id: String, room: RoomType): String =
        persistence.get(composerDraftKey(id, room))

    fun updateComposerDraft(text: String) {
        val current = _state.value
        if (!current.authenticated) return
        val key = composerDraftKey(current.activeConversationId, current.activeRoomType)
        _state.update { it.copy(composerDraft = text) }
        try {
            if (text.isEmpty()) persistence.remove(key) else persistence.put(key, text)
        } catch (_: Exception) {
            _state.update { it.copy(snackbarMessage = "输入草稿未能保存；请暂勿退出或切换窗口。") }
        }
    }

    private fun clearAcceptedDraft(id: String, room: RoomType, submitted: String) {
        val key = composerDraftKey(id, room)
        try {
            if (persistence.get(key) == submitted) persistence.remove(key)
            _state.update { current ->
                if (current.activeConversationId == id && current.composerDraft == submitted)
                    current.copy(composerDraft = "") else current
            }
        } catch (_: Exception) {
            _state.update { it.copy(snackbarMessage = "消息已经保存，但未能清除输入草稿。") }
        }
    }

    fun sendImage(text: String) {
        val prompt=text.trim()
        val current=_state.value
        if(generationJob?.isActive==true||generationRun!=null||current.isStreaming||current.isFinalizing||current.attachmentUploading||current.historyLoading)return
        if(prompt.length !in 1..4000){showPlaceholder("请输入1—4000字符的绘图提示。");return}
        if(current.currentImageModel.isBlank()){showPlaceholder("请先在模型箱选择生图模型。");return}
        if(current.activeRoomType==RoomType.Lighthouse){showPlaceholder("灯塔窗口不支持生图。");return}
        if(current.pendingAttachments.isNotEmpty()){showPlaceholder("手动生图暂不接收参考图或文件，请先移除待发送附件。");return}
        if(current.searchFocus!=null){showPlaceholder("请先结束旧版本预览。");return}
        beginGeneration(current.activeConversationId)
        generationJob=viewModelScope.launch(workDispatcher){
            var cid=""
            var requested=false
            try{
                val conversation=ensureRemoteConversation()
                cid=conversation.id
                generationRun?.ownerId=cid
                val base=backend.chat.loadHistory(cid)
                val appended=ChatSyncMapper.appendUser(base,prompt)
                val persisted=backend.chat.persistHistory(cid,appended.history)
                val turn=persisted.turns.first{it.id==appended.turnId}
                val uid=turn.user.variants[turn.user.active].id
                val mid=ChatSyncMapper.nextAssistantVariantId(persisted,turn.id)
                clearAcceptedDraft(cid,conversation.roomType,text)
                showHistory(cid,persisted)
                showPlaceholder("正在绘制图片…")
                requested=true
                val result=backend.chat.generateImage(cid,turn.id,uid,mid,prompt)
                showHistory(cid,result)
                showPlaceholder("图片已保存。")
            }catch(error:kotlinx.coroutines.CancellationException){
                if(requested&&cid.isNotBlank())kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable){runCatching{backend.chat.loadHistory(cid)}.onSuccess{showHistory(cid,it)}}
                throw error
            }catch(error:Exception){
                if(requested&&cid.isNotBlank())runCatching{backend.chat.loadHistory(cid)}.onSuccess{showHistory(cid,it)}
                showPlaceholder("生图未确认完成；请刷新窗口检查，不会自动重试。")
            }finally{finishGeneration()}
        }
    }

    fun sendMessage(text: String) {
        if (tourBlocksCloudAction()) return
        val clean = text.trim()
        val pendingAttachments = _state.value.pendingAttachments
        if ((clean.isBlank() && pendingAttachments.isEmpty()) || generationJob?.isActive == true || _state.value.isStreaming || _state.value.attachmentUploading) return
        if (!localMode && _state.value.currentModel.isBlank() && _state.value.activeRoomType != RoomType.Lighthouse) {
            showPlaceholder("当前模型还没有从后端载入，暂时不能发送。")
            return
        }
        pendingSearchHit = null
        _state.update { it.copy(searchFocus = null) }
        val submittedModel = _state.value.currentModel
        val submittedCrossWindow = consumeCrossWindowRequest()
        beginGeneration(_state.value.activeConversationId)
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                val conversation = ensureRemoteConversation()
                val conversationId = conversation.id
                generationRun?.ownerId = conversationId
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
                        submittedModel,
                        error
                    )
                    backend.chat.cacheHistory(conversationId, failed)
                    showHistory(conversationId, failed)
                    handleBackendError(error, "消息发送失败", keepAuthenticatedOnNetworkError = true)
                    return@launch
                }

                clearAcceptedDraft(conversationId, conversation.roomType, text)
                _state.update { it.copy(pendingAttachments = emptyList(), attachmentUploading = false) }

                if (conversation.roomType == RoomType.Lighthouse || (localMode && submittedModel.isBlank())) {
                    resetCrossWindow()
                    showHistory(conversationId, persistedUser)
                    _state.update { it.copy(snackbarMessage = if (localMode) "记录已保存在本机；当前不触发模型回复。" else "MCP 对话区已写入后端；这里按房间规则不触发模型回复") }
                    return@launch
                }
                generateTurn(
                    conversationId,
                    persistedUser,
                    appended.turnId,
                    submittedModel,
                    submittedCrossWindow
                )
            } catch (error: CoastApiException) {
                handleBackendError(error, "消息发送失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                finishGeneration()
            }
        }
    }

    fun uploadAttachment(name: String, mime: String, bytes: ByteArray) {
        if (tourBlocksCloudAction()) return
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
        if (tourBlocksCloudAction()) return
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
        if (SourceVisitGate.isActive && action !is MessageAction.Copy && action !is MessageAction.SelectVariant) {
            tourBlocksCloudAction()
            return
        }
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
                ChatHistoryMutations.toggleActiveAssistantLike(history, message.turnId ?: return@mutateMessageHistory history, message.remoteVariantId)
            }
            is MessageAction.ToggleFavorite -> mutateMessageHistory("收藏写回失败", "已同步收藏") { history ->
                ChatHistoryMutations.toggleActiveAssistantFavorite(history, message.turnId ?: return@mutateMessageHistory history, message.remoteVariantId)
            }
            is MessageAction.Delete -> deleteMessage(message)
            is MessageAction.Edit -> editMessage(message, action.text)
            is MessageAction.Regenerate -> regenerateMessage(message)
        }
    }

    fun stopGeneration() {
        if (generationRun?.ownerId != _state.value.activeConversationId || generationRun?.streaming != true) return
        generationJob?.cancel()
    }

    fun showPlaceholder(message: String) {
        _state.update { it.copy(snackbarMessage = message) }
    }

    private fun tourBlocksCloudAction(): Boolean {
        if (!SourceVisitGate.isActive) return false
        showPlaceholder("参观模式只供浏览；此操作需要连接自己的后端。")
        return true
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
                composerDraft = readComposerDraft(target?.id.orEmpty(), target?.roomType ?: RoomType.Main),
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
        val model_partner = profile?.assistantAvatarDataUrl.orEmpty().ifBlank { daily.modelPartnerAvatarDataUrl }
        _state.update {
            it.copy(
                currentModel = if (isChatGptPlanModel(it.currentModel)) it.currentModel else current.ifBlank { it.currentModel },
                currentImageModel = profile?.currentImageModel ?: it.currentImageModel,
                modelPartnerAvatarDataUrl = model_partner,
                ownerAvatarDataUrl = daily.ownerAvatarDataUrl,
                coverDataUrl = daily.momentCoverDataUrl
            )
        }
    }

    private fun applyModels(catalog: RemoteModelCatalogResponse?) {
        if (catalog == null) return
        val models = buildList {
            addAll(catalog.groups.openAiChat.map { it.id })
            addAll(catalog.groups.freeTest.map { it.id })
        }.filter(String::isNotBlank).distinct()
        val images = catalog.groups.openAiImage.map { it.id }.filter(String::isNotBlank).distinct()
        val current = _state.value.currentModel
        _state.update {
            it.copy(
                imageModels = images,
                models = if (!localMode && current.isNotBlank() && !isChatGptPlanModel(current) && current !in images && current !in models) listOf(current) + models else models,
                modelReasoningChoices = (catalog.groups.openAiChat + catalog.groups.freeTest).associate { it.id to it.reasoningEfforts },
                currentModel = if (localMode) current.takeIf { isChatGptPlanModel(it) || it in models }.orEmpty() else current.takeUnless { it in images }.orEmpty().ifBlank { models.firstOrNull().orEmpty() }
            )
        }
    }

    private fun loadConversation(conversation: ConversationSummary) {
        historyJob?.cancel()
        if (generationRun?.ownerId == conversation.id) {
            _state.update { generationUi(it.copy(historyLoading = false)) }
            return
        }
        val cached = backend.chat.cachedHistory(conversation.id)
        if (cached != null) showHistory(conversation.id, cached)
        loadThoughtSoil(conversation.id)
        historyJob = viewModelScope.launch(workDispatcher) {
            _state.update { it.copy(historyLoading = true) }
            try {
                val history = backend.chat.loadHistory(conversation.id)
                val focus = pendingSearchHit?.takeIf { it.conversationId == conversation.id }
                if (focus != null && previewSearchVariant(history, focus) == null) {
                    pendingSearchHit = null
                    _state.update { it.copy(
                        searchFocus = null,
                        snackbarMessage = "找不到这条消息的原版本；未跳转到其他版本。"
                    ) }
                }
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

    fun saveThoughtSoilManual(current: String, afterthoughts: List<String>) {
        if (tourBlocksCloudAction()) return
        val id = _state.value.activeConversationId
        if (id.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val soil = backend.thoughtSoil.saveManual(id, current, afterthoughts)
                if (_state.value.activeConversationId == id) _state.update {
                    it.copy(thoughtSoil = soil, snackbarMessage = "当前纸条已保存并手动锁定；解除锁定后才会恢复自动整理。")
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "纸条手动保存失败", keepAuthenticatedOnNetworkError = true)
            } catch (_: Exception) {
                _state.update { it.copy(snackbarMessage = "纸条手动保存失败。") }
            }
        }
    }

    fun resumeThoughtSoilAutomatic() {
        if (tourBlocksCloudAction()) return
        val id = _state.value.activeConversationId
        if (id.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val soil = backend.thoughtSoil.resumeAutomatic(id)
                if (_state.value.activeConversationId == id) _state.update {
                    it.copy(thoughtSoil = soil, snackbarMessage = "已解除手动锁定，恢复自动整理。")
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "解除纸条锁定失败", keepAuthenticatedOnNetworkError = true)
            } catch (_: Exception) {
                _state.update { it.copy(snackbarMessage = "解除纸条锁定失败。") }
            }
        }
    }

    fun setThoughtSoilEnabled(enabled: Boolean) {
        if (tourBlocksCloudAction()) return
        val conversationId = _state.value.activeConversationId
        if (conversationId.isBlank()) return
        viewModelScope.launch(workDispatcher) {
            try {
                val soil = backend.thoughtSoil.setEnabled(conversationId, enabled)
                if (_state.value.activeConversationId == conversationId) {
                    _state.update {
                        it.copy(
                            thoughtSoil = soil,
                            backendOffline = false,
                            snackbarMessage = if (enabled)
                                "当前对话纸条已开启，会继续整理并递入上下文。"
                            else "当前对话纸条已关闭；旧内容保留，但不再整理，也不递入上下文。"
                        )
                    }
                }
            } catch (error: CoastApiException) {
                handleBackendError(error, "当前对话纸条开关更新失败", keepAuthenticatedOnNetworkError = true)
            }
        }
    }

    fun setContextSettings(value: ConversationContextSettings) {
        if (tourBlocksCloudAction()) return
        if (_state.value.isStreaming || generationJob?.isActive == true) {
            showPlaceholder("当前回复仍在生成，完成后再修改窗口上下文。")
            return
        }
        val conversationId = _state.value.activeConversationId
        if (conversationId.isBlank()) return
        val previous = backend.chat.cachedHistory(conversationId) ?: run {
            showPlaceholder("聊天记录尚未载入完成，请重新打开窗口后再修改上下文。")
            return
        }
        val clean = value.normalized()
        val next = previous.copy(contextSettings = clean)
        if (next == previous) return
        backend.chat.cacheHistory(conversationId, next)
        showHistory(conversationId, next)
        viewModelScope.launch(workDispatcher) {
            try {
                val persisted = backend.chat.persistHistory(conversationId, next)
                showHistory(conversationId, persisted)
                _state.update { it.copy(backendOffline = false) }
            } catch (error: CoastApiException) {
                backend.chat.cacheHistory(conversationId, previous)
                showHistory(conversationId, previous)
                handleBackendError(error, "窗口上下文设置保存失败", keepAuthenticatedOnNetworkError = true)
            }
        }
    }

    private suspend fun organizeThoughtSoilAfterReply(conversationId: String, modelId: String) {
        try {
            val soil = backend.thoughtSoil.organizeAfterReply(conversationId, modelId)
            if (_state.value.activeConversationId == conversationId) {
                _state.update { it.copy(thoughtSoil = soil) }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (error is CoastApiException && error.kind == CoastApiErrorKind.Unauthorized) {
                handleBackendError(error, "当前对话纸条整理失败", keepAuthenticatedOnNetworkError = true)
            } else {
                _state.update { it.copy(snackbarMessage =
                    if (localMode && error is com.elementeracoast.app.core.local.LocalSoilFailure)
                        "当前对话纸条整理失败：${error.detail}；原纸条保留。"
                    else if (isChatGptPlanModel(modelId))
                        "ChatGPT 套餐整理失败；原纸条保留，不会调用另一模型供应商。"
                    else "当前对话纸条整理失败；本轮回复已保存，可以继续聊天。"
                ) }
            }
        }
    }

    private suspend fun ensureRemoteConversation(): ConversationSummary {
        val current = _state.value
        current.conversations.firstOrNull { it.id == current.activeConversationId }?.let { return it }
        val created = backend.conversations.create(current.activeRoomType, "新聊天")
        val empty = RemoteHistory(conversationId = created.id)
        backend.chat.cacheHistory(created.id, empty)
        persistence.put(KEY_CURRENT_CONVERSATION, created.id)
        // The first send or attachment allocates a real window; move its landing draft once.
        val landingKey = composerDraftKey("", current.activeRoomType)
        val realKey = composerDraftKey(created.id, created.roomType)
        val landingDraft = current.composerDraft
        if (landingDraft.isNotEmpty()) persistence.put(realKey, landingDraft)
        persistence.remove(landingKey)
        _state.update {
            it.copy(
                conversations = listOf(created) + it.conversations.filterNot { row -> row.id == created.id },
                activeConversationId = created.id,
                composerDraft = landingDraft,
                activeRoomType = created.roomType,
                contextSettings = empty.contextSettings.normalized(),
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
        if(history.contextSettings.replySequenceEnabled){
            generateReplyRun(conversationId,history,turnId,modelId,crossWindowRequest)
            return
        }
        var partial = ""
        var replySaved = false
        val cleared = backend.chat.clearFailure(history, turnId)
        val titleUserText = ChatSyncMapper.contextMessages(cleared, turnId, local.wolf.state.value.basic.recentTurns)
            .lastOrNull { it.role == "user" }
            ?.content
            .orEmpty()
        backend.chat.cacheHistory(conversationId, cleared)
        val streamingId = ChatSyncMapper.streamingMessageId(turnId)
        generationRun?.apply {
            ownerId = conversationId
            preparing = false
            streaming = true
            messageId = streamingId
        }
        showStreaming(conversationId, cleared, turnId, modelId, partial)
        _state.update { generationUi(it.copy(turnDeskReceipt = null)) }
        try {
            val realityContext = backend.reality.capture(cleared.contextSettings)
            (if (isChatGptPlanModel(modelId)) backend.officialChat
                ?: throw CoastApiException(
                    CoastApiErrorKind.Model, "chatgpt_plan_unavailable",
                    "当前安装包没有可用的 ChatGPT 套餐聊天执行器。"
                ) else backend.chat).streamReply(
                conversationId,
                cleared,
                turnId,
                modelId,
                local.wolf.state.value.basic.recentTurns,
                local.wolf.state.value.basic.contextBudget,
                local.wolf.state.value.basic.outputLength,
                local.wolf.state.value.basic.maxOutputTokens,
                crossWindowRequest,
                realityContext
            ).collect { progress ->
                when (progress) {
                    is ChatProgress.Delta -> {
                        partial += progress.text
                        showStreaming(conversationId, cleared, turnId, modelId, partial)
                    }
                    is ChatProgress.Completed -> {
                        replySaved = true
                        generationRun?.apply { streaming = false; preview = null }
                        _state.update(::generationUi)
                        showHistory(conversationId, progress.history)
                        if (_state.value.activeConversationId == conversationId) {
                            _state.update {
                                it.copy(
                                    backendOffline = false,
                                    turnDeskReceipt = progress.deskReceipt
                                )
                            }
                        }
                        if (!isChatGptPlanModel(progress.modelId)) refreshGeneratedTitle(conversationId, titleUserText, partial)
                        organizeThoughtSoilAfterReply(conversationId, progress.modelId)
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            if (replySaved) throw cancelled
            val stopped = withContext(NonCancellable) { settleInterruptedReply(conversationId,cleared,turnId,modelId,partial,null) }
            showHistory(conversationId, stopped)
            _state.update { it.copy(snackbarMessage = "已停止生成") }
            throw cancelled
        } catch (error: CoastApiException) {
            val failed = withContext(NonCancellable) { settleInterruptedReply(conversationId,cleared,turnId,modelId,partial,error) }
            showHistory(conversationId, failed)
            handleBackendError(error, "模型回复失败", keepAuthenticatedOnNetworkError = true)
        } finally {
            generationRun?.apply { streaming = false; preview = null }
            _state.update(::generationUi)
        }
    }

    private suspend fun generateReplyRun(cid:String,initial:RemoteHistory,tid:String,model:String,crossWindow:CrossWindowRequest){
        // Never silently switch a requested group into a paid single reply.
        if(isChatGptPlanModel(model)){
            showPlaceholder("当前模型通道尚未接通连续回复；未发起模型请求。");return
        }
        val window=initial.contextSettings
        val imageModel=_state.value.currentImageModel
 
        val source=initial.turns.firstOrNull{it.id==tid}?:return
        val user=source.user.variants.getOrNull(source.user.active)?:return
        val global=local.wolf.state.value.basic
        val quota=ReplySequence.resolveBudget(global,window,source.assistant.variantsByUserVariant[source.user.active.toString()].orEmpty().size)
        if(quota.maxMessages==0){showPlaceholder("回复分支已满，请先整理旧版本。");return}
        val sequenceId=java.util.UUID.randomUUID().toString()
        var canonical=initial
        var mid:String?=null
        var index=0
        var partial=""
        var tail:com.elementeracoast.app.core.remote.RemoteVariant?=null
        var end:ReplyRunEvent.End?=null
        val run=generationRun
        fun preview(){
            val messageId=mid?:return
            val messages=ChatSyncMapper.replyRunPreview(canonical,tid,user.id,sequenceId,messageId,index,model,partial)
            run?.preview=messages
            run?.messageId=messages.first{it.remoteVariantId==messageId}.id
            if(_state.value.activeConversationId==cid)_state.update{generationUi(it.copy(messages=messages))}
        }
        fun displayCanonical(){
            run?.preview=ChatSyncMapper.toUi(canonical)
            run?.messageId=null
            showHistory(cid,canonical)
            _state.update(::generationUi)
        }
        suspend fun readBack(){
            // The server owns settlement; a cancelled native client must
            // never synthesize a partial assistant or overwrite the group.
            canonical=runCatching{backend.chat.loadHistory(cid)}.getOrElse{backend.chat.cachedHistory(cid)?:canonical}
            displayCanonical()
        }
        run?.apply{preparing=false;streaming=true;preview=ChatSyncMapper.toUi(canonical);messageId=null}
        _state.update{generationUi(it.copy(turnDeskReceipt=null))}
        try{
            val reality=backend.reality.capture(window)
            val request=RemoteReplyRunRequest(cid,tid,user.id,sequenceId,model,RemoteReplyRunBudget(quota.maxMessages,quota.toolBudget,quota.tokenBudget),
                java.time.LocalDate.now().toString(),java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
                buildJsonObject{
                    put("recentTurns",global.recentTurns);put("contextBudget",global.contextBudget)
                    put("outputLength",global.outputLength);put("maxOutputTokens",global.maxOutputTokens)
                    put("streamingEnabled",global.streamingEnabled);put("toolCallLimit",global.toolCallLimit)
                    put("soilBudget",global.soilBudget);put("worldbookEnabled",global.worldbookEnabled)
                    put("worldbookLimit",global.worldbookLimit);put("memoryLimit",global.memoryLimit)
                    put("creativity",global.creativity)
                },reality,com.elementeracoast.app.core.remote.RemoteCrossWindowRequest(
                    when(crossWindow.mode){
                        com.elementeracoast.app.core.model.CrossWindowMode.Off->"off"
                        com.elementeracoast.app.core.model.CrossWindowMode.Manual->"manual"
                        com.elementeracoast.app.core.model.CrossWindowMode.ModelDecides->"model_decides"
                        else->"keyword"
                    },crossWindow.messages.map{com.elementeracoast.app.core.remote.RemoteCrossWindowMessageSelection(it.conversationId,it.messageId)}),
                imageToolEnabled=imageModel.isNotBlank(),imageModelId=imageModel.takeIf{it.isNotBlank()})
            backend.chat.streamReplyRun(request).collect{event->
                when(event){
                    is ReplyRunEvent.Start->Unit
                    is ReplyRunEvent.Begin->{mid=event.messageId;index=event.index;partial="";preview()}
                    is ReplyRunEvent.Delta->{partial+=event.content;preview()}
                    is ReplyRunEvent.Committed->{
                        canonical=event.history;tail=event.variant;mid=null;partial=""
                        displayCanonical()
                        if(_state.value.activeConversationId==cid)_state.update{it.copy(backendOffline=false,
                            turnDeskReceipt=event.variant.deskSlip?.let(com.elementeracoast.app.feature.chat.TurnDeskMapper::toUi))}
                    }
                    is ReplyRunEvent.End->{end=event;event.history?.let{canonical=it};displayCanonical()}
                }
            }
            val settled=end?:throw CoastApiException(CoastApiErrorKind.Stream,"reply_group_incomplete","未确认整组结束。")
            run?.apply{streaming=false;preview=null;messageId=null}
            _state.update(::generationUi)
            if(settled.status !in setOf("completed","limit_reached"))showPlaceholder(settled.message?:"连续回复已停止；正式消息保留。")
            tail?.let{last->
                try{
                    val paper=backend.thoughtSoil.organizeAfterSequence(cid,last.modelId?:model,sequenceId)
                    if(_state.value.activeConversationId==cid)_state.update{it.copy(thoughtSoil=paper)}
                }catch(cancelled:CancellationException){throw cancelled}
                catch(_:Exception){showPlaceholder("回复组已保存；思维壤整理未确认。")}
                val group=canonical.turns.firstOrNull{it.id==tid}?.assistant?.variantsByUserVariant?.get(source.user.active.toString()).orEmpty()
                    .filter{it.replySequence?.id==sequenceId}
                refreshGeneratedTitle(cid,user.content,group.joinToString("\n\n"){it.content})
            }
        }catch(cancelled:CancellationException){
            withContext(NonCancellable){readBack()};showPlaceholder("已停止；保留确认写入的回复，不会自动重试。");throw cancelled
        }catch(error:CoastApiException){
            withContext(NonCancellable){readBack()};handleBackendError(error,"连续回复未确认完成",keepAuthenticatedOnNetworkError=true)
        }finally{
            run?.apply{streaming=false;preview=null;messageId=null}
            _state.update(::generationUi)
        }
    }

    private suspend fun settleInterruptedReply(cid:String,base:RemoteHistory,tid:String,model:String,partial:String,failure:CoastApiException?):RemoteHistory {
        val cached=backend.chat.cachedHistory(cid)
        val fresh=runCatching{backend.chat.loadHistory(cid)}.getOrNull()
        val mid=ChatSyncMapper.nextAssistantVariantId(base,tid)
        val source=base.turns.firstOrNull{it.id==tid}
        val uid=source?.user?.variants?.getOrNull(source.user.active)?.id.orEmpty()
        fun reserved(h:RemoteHistory?)=h?.turns?.firstOrNull{it.id==tid}?.assistant?.variantsByUserVariant?.values?.flatten()?.firstOrNull{it.id==mid&&it.finishReason in setOf("image_tool_ready","image_pending","image_saved","image_failed")}
        val v=reserved(fresh)
        if(v!=null&&fresh!=null){
            if(v.finishReason=="image_pending")return fresh
            val next=runCatching{ChatSyncMapper.completeReservedAssistant(fresh,tid,uid,mid,partial,model,if(failure==null)"cancelled"else "error",error=failure?.message)}.getOrElse{return fresh}
            return runCatching{backend.chat.persistHistory(cid,next)}.getOrElse{fresh}
        }
        if(fresh==null&&(reserved(cached)!=null||_state.value.currentImageModel.isNotBlank()))return cached?:base
        val next=if(failure==null)backend.chat.cancelledHistory(base,tid,model,partial)else backend.chat.failedHistory(base,tid,model,failure,partial)
        return runCatching{backend.chat.persistHistory(cid,next)}.getOrElse{fresh?:cached?:base}
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
        val submittedCrossWindow = consumeCrossWindowRequest()
        beginGeneration(conversationId)
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                val cleared = backend.chat.clearFailure(history, turnId)
                val persisted = backend.chat.persistHistory(conversationId, cleared)
                showHistory(conversationId, persisted)
                generateTurn(conversationId, persisted, turnId, model, submittedCrossWindow)
            } catch (error: CoastApiException) {
                val failed = backend.chat.failedHistory(history, turnId, model, error)
                backend.chat.cacheHistory(conversationId, failed)
                showHistory(conversationId, failed)
                handleBackendError(error, "重试失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                finishGeneration()
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
        mutateMessageHistory("删除消息失败", "消息已删除", explicitDeletion=true) { history ->
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

        val submittedModel = _state.value.currentModel
        val submittedCrossWindow = consumeCrossWindowRequest()
        beginGeneration(conversationId)
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                val persisted = backend.chat.persistHistory(conversationId, edited)
                showHistory(conversationId, persisted)
                val conversation = _state.value.conversations.firstOrNull { it.id == conversationId }
                if (conversation?.roomType == RoomType.Lighthouse) {
                    _state.update { it.copy(snackbarMessage = "编辑版本已写回后端") }
                    return@launch
                }
                val model = submittedModel
                if (model.isBlank()) {
                    _state.update { it.copy(snackbarMessage = "编辑版本已写回；当前没有可用聊天模型，未生成新回复") }
                    return@launch
                }
                generateTurn(conversationId, persisted, turnId, model, submittedCrossWindow)
            } catch (error: CoastApiException) {
                backend.chat.cacheHistory(conversationId, previous)
                showHistory(conversationId, previous)
                handleBackendError(error, "编辑消息失败", keepAuthenticatedOnNetworkError = true)
            } finally {
                finishGeneration()
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
        val submittedCrossWindow = consumeCrossWindowRequest()
        beginGeneration(conversationId)
        generationJob = viewModelScope.launch(workDispatcher) {
            try {
                generateTurn(conversationId, history, turnId, model, submittedCrossWindow)
            } finally {
                finishGeneration()
            }
        }
    }

    private fun mutateMessageHistory(
        failureLabel: String,
        successMessage: String,
        explicitDeletion:Boolean=false,
        transform: (RemoteHistory) -> RemoteHistory
    ) {
        if (_state.value.isStreaming || generationJob?.isActive == true) {
            showPlaceholder("当前回复仍在生成，完成后再修改消息。")
            return
        }
        val conversationId = _state.value.activeConversationId
        if (conversationId.isBlank()) return
        pendingSearchHit = null
        _state.update { it.copy(searchFocus = null) }
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
                val persisted = if(explicitDeletion)backend.chat.deleteFromHistory(conversationId,next,previous.updatedAt)else backend.chat.persistHistory(conversationId,next)
                showHistory(conversationId, persisted)
                _state.update { it.copy(backendOffline = false, snackbarMessage = successMessage) }
            } catch (error: CoastApiException) {
                val restored=runCatching{backend.chat.loadHistory(conversationId)}.getOrElse{previous}
                backend.chat.cacheHistory(conversationId, restored)
                showHistory(conversationId, restored)
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
        val messages = ChatSyncMapper.toUi(history) + ChatSyncMapper.streamingAssistant(turnId, modelId, partial)
        generationRun?.takeIf { it.ownerId == conversationId }?.preview = messages
        if (_state.value.activeConversationId == conversationId) _state.update { it.copy(messages = messages) }
    }

    private fun showHistory(conversationId: String, history: RemoteHistory) {
        if (_state.value.activeConversationId != conversationId) return
        val hit = pendingSearchHit?.takeIf { it.conversationId == conversationId }
        // Search previews are presentation-only. Never replace the cached canonical
        // history: a later send/regenerate/mutation must use the persisted active branch.
        val displayed = hit?.let { previewSearchVariant(history, it) } ?: history
        _state.update {
            it.copy(
                messages = ChatSyncMapper.toUi(displayed),
                contextSettings = displayed.contextSettings.normalized()
            )
        }
    }

    private fun activateCachedConversation(conversation: ConversationSummary) {
        resetCrossWindow()
        persistence.put(KEY_CURRENT_CONVERSATION, conversation.id)
        val history = backend.chat.cachedHistory(conversation.id)
        val run = generationRun?.takeIf { it.ownerId == conversation.id }
        val hit = pendingSearchHit?.takeIf { it.conversationId == conversation.id && run == null }
        val displayed = if (hit != null && history != null) previewSearchVariant(history, hit) ?: history
            else history
        _state.update {
            generationUi(it.copy(
                activeRoomType = conversation.roomType,
                activeFeature = null,
                actionLogFocusIds = emptySet(),
                activeConversationId = conversation.id,
                composerDraft = readComposerDraft(conversation.id, conversation.roomType),
                searchFocus = hit?.let { ChatSearchFocus(conversation.id, it.messageId, searchNavigationId) },
                contextSettings = displayed?.contextSettings?.normalized() ?: ConversationContextSettings(),
                messages = run?.preview ?: displayed?.let(ChatSyncMapper::toUi).orEmpty(),
                thoughtSoil = null,
                turnDeskReceipt = null,
                showModelPicker = false,
                isStreaming = false,
                isFinalizing = false,
                streamingMessageId = null,
                streamingVariantIndex = null
            ))
        }
    }

    private fun openRoomLanding(roomType: RoomType) {
        require(roomType in RoomType.entries)
        resetCrossWindow()
        pendingSearchHit = null
        persistence.remove(KEY_CURRENT_CONVERSATION)
        _state.update {
            generationUi(it.copy(
                activeRoomType = roomType,
                activeFeature = null,
                actionLogFocusIds = emptySet(),
                activeConversationId = "",
                composerDraft = readComposerDraft("", roomType),
                searchFocus = null,
                contextSettings = ConversationContextSettings(),
                messages = emptyList(),
                thoughtSoil = null,
                turnDeskReceipt = null,
                showModelPicker = false,
                historyLoading = false,
                isStreaming = false,
                isFinalizing = false,
                streamingMessageId = null,
                streamingVariantIndex = null
            ))
        }
    }

    private fun consumeCrossWindowRequest(): CrossWindowRequest {
        val request = _crossWindow.value.request()
        _crossWindow.value = CrossWindowUiState()
        if(localMode && request.messages.isEmpty() &&
            _state.value.contextSettings.crossWindowAuto)
            return CrossWindowRequest(mode=com.elementeracoast.app.core.model.CrossWindowMode.ModelDecides)
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

    override fun onCleared() {
        generationJob?.cancel()
        generationRun?.lease?.close()
        super.onCleared()
    }

    companion object {
        private const val KEY_CURRENT_CONVERSATION = "remote.current-conversation.v1"

        fun factory(context: Context): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                val appContext = context.applicationContext
                val isLocal = NativeWorkspace.isLocal
                val persistence = NativeWorkspace.persistence(appContext)
                val chatGpt = ChatGptPlanRepository(ChatGptSecureStore(appContext, localMode = isLocal))
                val backend = CoastBackendGraph.production(appContext, persistence, chatGpt)
                return CoastShellViewModel(persistence, backend, chatGpt = chatGpt, localMode = isLocal,
                    foregroundLease = { cancel, unavailable -> GenerationForegroundService.acquire(appContext, cancel, unavailable) }) as T
            }
        }
    }
}
