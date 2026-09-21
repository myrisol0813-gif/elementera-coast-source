package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.FeatureDestination
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.RoomType
import com.elementeracoast.app.feature.chat.ChatWindow
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
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onMessageAction: (MessageAction) -> Unit,
    onOpenActionLog: (Set<String>) -> Unit,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onLocalActionLogged: (String, String, String) -> Unit,
    onOpenModels: () -> Unit,
    onDismissModels: () -> Unit,
    onSelectModel: (String) -> Unit,
    onRefreshModels: () -> Unit,
    onLogout: () -> Unit,
    onPlaceholder: (String) -> Unit,
    onSnackbarShown: () -> Unit
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val snackbar = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    var openPendingMemoryOnLanding by remember { mutableStateOf(false) }
    var showThemeWardrobe by remember { mutableStateOf(false) }
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

    CompositionLocalProvider(LocalSnowLetterVisuals provides snowLetterVisuals) {
        ModalNavigationDrawer(
            drawerState = drawerState,
            gesturesEnabled = true,
            drawerContent = {
                CoastDrawer(
                    state = state,
                    onClose = { coroutineScope.launch { drawerState.close() } },
                    onOpenRoomType = { roomType -> closeDrawerThen { onOpenRoomType(roomType) } },
                    onSelectConversation = { id -> closeDrawerThen { onSelectConversation(id) } },
                    onRenameConversation = onRenameConversation,
                    onDeleteConversation = onDeleteConversation,
                    onOpenFeature = { destination -> closeDrawerThen { onOpenFeature(destination) } },
                    onCycleTheme = { closeDrawerThen { showThemeWardrobe = true } }
                )
            }
        ) {
            val ownsPageChrome = state.activeFeature == FeatureDestination.Memory ||
                state.activeFeature == FeatureDestination.Daily ||
                state.activeFeature == FeatureDestination.IslandLetter
            Scaffold(
                modifier = Modifier.fillMaxSize(),
                containerColor = MaterialTheme.colorScheme.background,
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = {
                    if (!ownsPageChrome) {
                        CoastTopBar(
                            state = state,
                            onOpenDrawer = { coroutineScope.launch { drawerState.open() } },
                            onBack = onBackToChat,
                            onOpenModels = onOpenModels,
                            onRefresh = onRefresh,
                            onNewConversation = onNewConversation,
                            onMore = { onOpenFeature(FeatureDestination.IslandLetter) }
                        )
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
                            onSend = onSend,
                            onStop = onStop,
                            onMessageAction = onMessageAction,
                            onOpenActionLog = onOpenActionLog,
                            onOpenPendingMemory = {
                                openPendingMemoryOnLanding = true
                                onOpenFeature(FeatureDestination.Memory)
                            },
                            onPlaceholder = onPlaceholder
                        )
                    } else {
                        FeatureLandingScreen(
                            feature = feature,
                            shellState = state,
                            services = services,
                            daily = daily,
                            memory = memory,
                            devHands = devHands,
                            archive = archive,
                            openMemoryPending = openPendingMemoryOnLanding,
                            onMemoryPendingConsumed = { openPendingMemoryOnLanding = false },
                            messages = state.messages,
                            onBackToChat = onBackToChat,
                            onRefresh = onRefresh,
                            onUpdateModelPartnerAvatar = onUpdateModelPartnerAvatar,
                            onSelectModel = onSelectModel,
                            onRefreshModels = onRefreshModels,
                            onLogout = onLogout,
                            onImportMessages = onImportMessages,
                            onLocalActionLogged = onLocalActionLogged,
                            onPlaceholder = onPlaceholder
                        )
                    }
                }
            }
        }

        if (state.showModelPicker && state.activeFeature == null) {
            ModelQuickPicker(state.models, state.currentModel, onSelectModel, onDismissModels)
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