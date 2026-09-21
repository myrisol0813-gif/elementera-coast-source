package com.elementeracoast.app.feature.shell

import androidx.compose.runtime.Composable
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.FeatureDestination
import com.elementeracoast.app.feature.daily.DailyLanding
import com.elementeracoast.app.feature.daily.DailyRepository
import com.elementeracoast.app.feature.letters.IslandLetterScreen
import com.elementeracoast.app.feature.memory.MemoryLanding
import com.elementeracoast.app.feature.memory.MemoryRepository
import com.elementeracoast.app.feature.serpentdesk.DevHandsRepository
import com.elementeracoast.app.feature.serpentdesk.SerpentDeskScreen
import com.elementeracoast.app.feature.wolf.GlobalArchiveRepository
import com.elementeracoast.app.feature.wolf.WolfScreen
import com.elementeracoast.app.ui.theme.SnowLetterFeatureScaffold

@Composable
internal fun FeatureLandingScreen(
    feature: FeatureDestination,
    shellState: CoastShellState,
    services: LocalFeatureServices,
    daily: DailyRepository,
    memory: MemoryRepository,
    devHands: DevHandsRepository,
    archive: GlobalArchiveRepository,
    openMemoryPending: Boolean,
    onMemoryPendingConsumed: () -> Unit,
    messages: List<ChatMessage>,
    onBackToChat: () -> Unit,
    onRefresh: () -> Unit,
    onUpdateModelPartnerAvatar: (String) -> Unit,
    onSelectModel: (String) -> Unit,
    onRefreshModels: () -> Unit,
    onLogout: () -> Unit,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onLocalActionLogged: (String, String, String) -> Unit,
    onPlaceholder: (String) -> Unit
) {
    SnowLetterFeatureScaffold {
        when (feature) {
            FeatureDestination.Daily -> DailyLanding(
                repository = daily,
                myriAvatarDataUrl = shellState.myriAvatarDataUrl,
                onUpdateModelPartnerAvatar = onUpdateModelPartnerAvatar,
                onRefreshCoast = onRefresh,
                onBackToChat = onBackToChat,
                onActionLogged = onLocalActionLogged,
                onSnackbar = onPlaceholder
            )
            FeatureDestination.Memory -> MemoryLanding(
                repository = memory,
                conversationId = shellState.activeConversationId,
                openPendingInitially = openMemoryPending,
                onPendingOpenConsumed = onMemoryPendingConsumed,
                onBackToChat = onBackToChat,
                onActionLogged = onLocalActionLogged,
                onSnackbar = onPlaceholder
            )
            FeatureDestination.Wolf -> WolfScreen(
                store = services.wolf,
                shellState = shellState,
                messages = messages,
                devHands = devHands,
                archive = archive,
                onSelectModel = onSelectModel,
                onRefreshModels = onRefreshModels,
                onLogout = onLogout,
                onImportMessages = onImportMessages,
                onActionLogged = onLocalActionLogged,
                onSnackbar = onPlaceholder
            )
            FeatureDestination.ActionLog -> SerpentDeskScreen(
                actionLogStore = services.actionLog,
                devHands = devHands,
                conversationId = shellState.activeConversationId,
                focusIds = shellState.actionLogFocusIds
            )
            FeatureDestination.IslandLetter -> IslandLetterScreen(
                store = services.islandLetter,
                conversationId = shellState.activeConversationId,
                modelName = shellState.currentModel,
                recentTurns = services.wolf.state.value.basic.recentTurns,
                contextBudget = services.wolf.state.value.basic.contextBudget,
                onBack = onBackToChat,
                onRefreshCoast = onRefresh,
                onSnackbar = onPlaceholder
            )
        }
    }
}
