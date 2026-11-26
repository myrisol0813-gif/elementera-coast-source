package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.tour.SourceVisitGate
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.ChatSearchHit
import com.elementeracoast.app.core.model.FeatureDestination
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.RoomType
import com.elementeracoast.app.feature.chat.ChatWindow
import com.elementeracoast.app.feature.chatgpt.ChatGptConnectState
import com.elementeracoast.app.feature.chat.ModelQuickPicker
import com.elementeracoast.app.feature.daily.DailyRepository
import com.elementeracoast.app.feature.dogtalk.CrossWindowRepository
import com.elementeracoast.app.feature.dogtalk.CrossWindowUiState
import com.elementeracoast.app.feature.dogtalk.DogtalkRepository
import com.elementeracoast.app.feature.memory.MemoryRepository
import com.elementeracoast.app.feature.serpentdesk.DevHandsRepository
import com.elementeracoast.app.feature.wolf.GlobalArchiveRepository
import com.elementeracoast.app.ui.theme.CoastThemePreset
import com.elementeracoast.app.ui.theme.LocalSnowLetterVisuals
import com.elementeracoast.app.ui.theme.SnowLetterVisualSettings
import kotlinx.coroutines.launch

@Composable
fun MainShell(
    state: CoastShellState,
    chatGpt: ChatGptConnectState,
    services: LocalFeatureServices,
    daily: DailyRepository,
    memory: MemoryRepository,
    dogtalk: DogtalkRepository,
    devHands: DevHandsRepository,
    archive: GlobalArchiveRepository,
    crossWindowRepository: CrossWindowRepository,
    crossWindow: CrossWindowUiState,
    onCrossWindowChange: (CrossWindowUiState) -> Unit,
    onOpenRoomType: (RoomType) -> Unit,
    onSelectConversation: (String) -> Unit,
    onSelectSearchHit: (ChatSearchHit) -> Unit,
    onNewConversation: () -> Unit,
    onRenameConversation: (String, String) -> Unit,
    onDeleteConversation: (String) -> Unit,
    onSelectTheme: (CoastThemePreset) -> Unit,
    onOpenFeature: (FeatureDestination) -> Unit,
    onBackToChat: () -> Unit,
    onRefresh: () -> Unit,
    onUpdateModelPartnerAvatar: (String) -> Unit,
    onUploadAttachment: (String, String, ByteArray) -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onComposerDraftChange: (String) -> Unit,
    onSend: (String) -> Unit,
    onSendImage: (String) -> Unit = {},
    onStop: () -> Unit,
    onMessageAction: (MessageAction) -> Unit,
    onOpenActionLog: (Set<String>) -> Unit,
    onSetThoughtSoilEnabled: (Boolean) -> Unit,
    onSaveThoughtSoil: (String, List<String>) -> Unit,
    onResumeThoughtSoil: () -> Unit,
    onSetContextSettings: (ConversationContextSettings) -> Unit,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onLocalActionLogged: (String, String, String) -> Unit,
    onOpenModels: () -> Unit,
    onDismissModels: () -> Unit,
    onSelectModel: (String) -> Unit,
    onSelectImageModel: (String) -> Unit = {},
    onRefreshModels: () -> Unit,
    onChatGptConnect: () -> Unit,
    onChatGptDisconnect: () -> Unit,
    onChatGptRefresh: () -> Unit,
    onChatGptProbe: (String) -> Unit,
    onEnterLocalWorkspace: () -> Unit,
    onLogout: () -> Unit,
    onPlaceholder: (String) -> Unit,
    onSnackbarShown: () -> Unit
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val snackbar = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    val headerContext = LocalContext.current.applicationContext
    val headerPrefs = remember(headerContext) { headerContext.getSharedPreferences("coast_header_appearance", android.content.Context.MODE_PRIVATE) }
    val headerKey = if (state.localMode) "local_header_title" else "online_header_title"
    var headerTitle by remember(headerPrefs, headerKey) { mutableStateOf(headerPrefs.getString(headerKey, "ChatGPT").orEmpty().ifBlank { "ChatGPT" }) }
    fun saveHeaderTitle(raw:String){
        val value=raw.trim().take(40).ifBlank{"ChatGPT"}
        headerPrefs.edit().putString(headerKey,value).apply()
        headerTitle=value
    }
    var openPendingMemoryOnLanding by remember { mutableStateOf(false) }
    var openModelBoxOnLanding by rememberSaveable { mutableStateOf(false) }
    var showThemeWardrobe by remember { mutableStateOf(false) }
    var showWindowContext by rememberSaveable { mutableStateOf(false) }
    var showManual by rememberSaveable { mutableStateOf(false) }
    var guideRequest by remember { mutableStateOf<String?>(null) }
    fun navigateGuide(target: String) {
        showManual = false
        guideRequest = null
        openModelBoxOnLanding = false
        when (target) {
            "main", "history", "echo", "attachments" -> if (state.activeRoomType == RoomType.Main) onBackToChat() else onOpenRoomType(RoomType.Main)
            "radio" -> if (!state.localMode) onOpenRoomType(RoomType.Radio) else onPlaceholder("本机暂不支持共通聊天室。")
            "lighthouse" -> if (!state.localMode) onOpenRoomType(RoomType.Lighthouse) else onPlaceholder("本机暂不支持 MCP 对话区。")
            "window", "reality", "short", "readTools", "writeTools" -> {
                onBackToChat()
                showWindowContext = true
            }
            "drawer", "draft", "cross", "soil", "desk" -> { guideRequest = target; onBackToChat() }
            "letter" -> onOpenFeature(FeatureDestination.IslandLetter)
            "memory", "seeds", "pending", "userPortrait", "selfPortrait", "worldbook", "instructions" -> {
                guideRequest = target; onOpenFeature(FeatureDestination.Memory)
            }
            "daily", "moments", "diary", "calendar", "vault", "collection", "library", "pets" -> {
                guideRequest = target; onOpenFeature(FeatureDestination.Daily)
            }
            "tools", "toolLog" -> onOpenFeature(FeatureDestination.ActionLog)
            "models", "codex", "provider", "settings", "profile", "appearance", "account", "basic", "backup", "diagnostics", "update" -> {
                guideRequest = target; onOpenFeature(FeatureDestination.Wolf)
            }
        }
    }
    val defaultSnowLetterVisuals = remember { SnowLetterVisualSettings() }
    var snowLetterBackgroundAlpha by rememberSaveable { mutableStateOf(defaultSnowLetterVisuals.chatBackgroundAlpha) }
    var snowLetterDecorationAlpha by rememberSaveable { mutableStateOf(defaultSnowLetterVisuals.decorationAlpha) }
    var snowLetterPaperTextureAlpha by rememberSaveable { mutableStateOf(defaultSnowLetterVisuals.paperTextureAlpha) }
    val snowLetterVisuals = remember(
        snowLetterBackgroundAlpha,
        snowLetterDecorationAlpha,
        snowLetterPaperTextureAlpha
    ) {
        SnowLetterVisualSettings(
            chatBackgroundAlpha = snowLetterBackgroundAlpha,
            decorationAlpha = snowLetterDecorationAlpha,
            paperTextureAlpha = snowLetterPaperTextureAlpha
        )
    }

    LaunchedEffect(state.snackbarMessage) {
        val message = state.snackbarMessage ?: return@LaunchedEffect
        snackbar.showSnackbar(message)
        onSnackbarShown()
    }

    fun closeDrawerThen(block: () -> Unit) {
        block()
        coroutineScope.launch { drawerState.close() }
    }

    CompositionLocalProvider(LocalSnowLetterVisuals provides snowLetterVisuals, LocalOpenGuideManual provides { showManual = true }) {
        ModalNavigationDrawer(
            drawerState = drawerState,
            gesturesEnabled = true,
            drawerContent = {
                CoastDrawer(
                    state = state,
                    drawerOpen = drawerState.isOpen,
                    onSnackbar = onPlaceholder,
                    onClose = { coroutineScope.launch { drawerState.close() } },
                    onOpenRoomType = { roomType -> closeDrawerThen { onOpenRoomType(roomType) } },
                    onSelectConversation = { id -> closeDrawerThen { onSelectConversation(id) } },
                    onSelectSearchHit = { hit -> closeDrawerThen { onSelectSearchHit(hit) } },
                    onRenameConversation = onRenameConversation,
                    onDeleteConversation = onDeleteConversation,
                    onOpenFeature = { destination -> closeDrawerThen { openModelBoxOnLanding = false; onOpenFeature(destination) } },
                    onCycleTheme = { closeDrawerThen { showThemeWardrobe = true } }
                )
            }
        ) {
            val ownsPageChrome = state.activeFeature == FeatureDestination.Memory ||
                state.activeFeature == FeatureDestination.Daily ||
                state.activeFeature == FeatureDestination.IslandLetter ||
                state.activeFeature == FeatureDestination.Wolf
            Scaffold(
                modifier = Modifier.fillMaxSize(),
                containerColor = MaterialTheme.colorScheme.background,
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = {
                    Column {
                        if (!ownsPageChrome) {
                            CoastTopBar(
                                state = state,
                                headerTitle = headerTitle,
                                onOpenDrawer = { coroutineScope.launch { drawerState.open() } },
                                onBack = onBackToChat,
                                onOpenModels = onOpenModels,
                                onRefresh = onRefresh,
                                onNewConversation = onNewConversation,
                                onMore = { showWindowContext = true }
                            )
                        }
                        if (SourceVisitGate.isActive) {
                            Text(
                                text = "参观模式 · 原有页面可浏览 · 不连接云端",
                                modifier = Modifier.fillMaxWidth()
                                    .background(MaterialTheme.colorScheme.secondaryContainer)
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            ) { innerPadding ->
                Box(Modifier.fillMaxSize().padding(innerPadding)) {
                    val feature = state.activeFeature
                    if (feature == null) {
                        ChatWindow(
                            state = state,
                            dogtalk = dogtalk,
                            crossWindowRepository = crossWindowRepository,
                            crossWindow = crossWindow,
                            onCrossWindowChange = onCrossWindowChange,
                            onUploadAttachment = onUploadAttachment,
                            onRemovePendingAttachment = onRemovePendingAttachment,
                            onComposerDraftChange = onComposerDraftChange,
                            onSend = onSend,
                            onSendImage = onSendImage,
                            onStop = onStop,
                            onMessageAction = onMessageAction,
                            onOpenActionLog = onOpenActionLog,
                            onSetThoughtSoilEnabled = onSetThoughtSoilEnabled,
                            onSaveThoughtSoil = onSaveThoughtSoil,
                            onResumeThoughtSoil = onResumeThoughtSoil,
                            onOpenPendingMemory = {
                                openPendingMemoryOnLanding = true
                                onOpenFeature(FeatureDestination.Memory)
                            },
                            onPlaceholder = onPlaceholder,
                            guideTarget = guideRequest,
                            onGuideConsumed = { guideRequest = null }
                        )
                    } else {
                        FeatureLandingScreen(
                            feature = feature,
                            shellState = state,
                            chatGpt = chatGpt,
                            services = services,
                            daily = daily,
                            memory = memory,
                            devHands = devHands,
                            archive = archive,
                            openMemoryPending = openPendingMemoryOnLanding,
                            guideTarget = guideRequest,
                            onGuideConsumed = { guideRequest = null },
                            openModelBoxInitially = openModelBoxOnLanding,
                            onMemoryPendingConsumed = { openPendingMemoryOnLanding = false },
                            messages = state.messages,
                            onBackToChat = { openModelBoxOnLanding = false; onBackToChat() },
                            onOpenSearchHit = onSelectSearchHit,
                            onRefresh = onRefresh,
                            onUpdateModelPartnerAvatar = onUpdateModelPartnerAvatar,
                            onSelectModel = onSelectModel,
                            onSelectImageModel = onSelectImageModel,
                            onRefreshModels = onRefreshModels,
                            onChatGptConnect = onChatGptConnect,
                            onChatGptDisconnect = onChatGptDisconnect,
                            onChatGptRefresh = onChatGptRefresh,
                            onChatGptProbe = onChatGptProbe,
                            onEnterLocalWorkspace = onEnterLocalWorkspace,
                            onLogout = onLogout,
                            onImportMessages = onImportMessages,
                            onLocalActionLogged = onLocalActionLogged,
                            onPlaceholder = onPlaceholder
                        )
                    }
                }
            }
        }

        if (showManual) FeatureManual(state.localMode, onDismiss = { showManual = false }, onNavigate = ::navigateGuide)
        if (showWindowContext && state.activeFeature == null) {
            WindowContextSheet(
                conversationId = state.activeConversationId,
                settings = state.contextSettings,
                thoughtSoilEnabled = state.thoughtSoil?.autoRefreshEnabled ?: true,
                onSettingsChange = onSetContextSettings,
                onSetThoughtSoilEnabled = onSetThoughtSoilEnabled,
                onOpenIslandLetter = {
                    showWindowContext = false
                    onOpenFeature(FeatureDestination.IslandLetter)
                },
                onDismiss = { showWindowContext = false }
            )
        }
        if (state.showModelPicker && state.activeFeature == null) {
            ModelQuickPicker(
                models = state.models,
                modelReasoningChoices = state.modelReasoningChoices,
                currentModel = state.currentModel,
                imageModels = state.imageModels,
                currentImage = state.currentImageModel,
                headerTitle = headerTitle,
                onHeaderTitle = ::saveHeaderTitle,
                onPickImage = onSelectImageModel,
                onPick = onSelectModel,
                onDismiss = onDismissModels,
                chatGpt = chatGpt,
                onChatGptConnect = onChatGptConnect,
                onChatGptRefresh = onChatGptRefresh,
                localMode = state.localMode,
                onOpenModelBox = { onDismissModels(); openModelBoxOnLanding = true; onOpenFeature(FeatureDestination.Wolf) }
            )
        }
        if (showThemeWardrobe) {
            ThemeWardrobeSheet(
                current = state.theme,
                snowLetterVisuals = snowLetterVisuals,
                onSnowLetterVisualsChange = { next ->
                    snowLetterBackgroundAlpha = next.chatBackgroundAlpha
                    snowLetterDecorationAlpha = next.decorationAlpha
                    snowLetterPaperTextureAlpha = next.paperTextureAlpha
                },
                onSelect = onSelectTheme,
                onDismiss = { showThemeWardrobe = false }
            )
        }
    }
}