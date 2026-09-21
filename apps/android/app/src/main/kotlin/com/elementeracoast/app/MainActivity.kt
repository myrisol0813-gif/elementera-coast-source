package com.elementeracoast.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.elementeracoast.app.feature.gate.GateScreen
import com.elementeracoast.app.feature.gate.MailboxNativeSurface
import com.elementeracoast.app.feature.serpentdesk.DevHandsProvider
import com.elementeracoast.app.feature.shell.CoastShellViewModel
import com.elementeracoast.app.feature.shell.MainShell
import com.elementeracoast.app.ui.theme.CoastTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val vm: CoastShellViewModel = viewModel(factory = CoastShellViewModel.factory(applicationContext))
            val devHands = remember(applicationContext) { DevHandsProvider.production(applicationContext) }
            val state by vm.state.collectAsState()
            val crossWindow by vm.crossWindow.collectAsState()
            val wolf by vm.local.wolf.state.collectAsState()
            var mailboxOpen by rememberSaveable { mutableStateOf(false) }
            LaunchedEffect(wolf.appearance) { vm.syncAppearance() }

            CoastTheme(
                preset = wolf.appearance.theme,
                accentHex = wolf.appearance.accentHex,
                userBubbleHex = wolf.appearance.userBubbleHex
            ) {
                if (mailboxOpen) {
                    MailboxNativeSurface(onClose = { mailboxOpen = false })
                } else if (!state.authenticated) {
                    GateScreen(
                        password = state.password,
                        authBusy = state.authBusy,
                        authMessage = state.authMessage,
                        onPasswordChange = vm::setPassword,
                        onEnter = vm::enterCoast,
                        onOpenMailbox = { mailboxOpen = true }
                    )
                } else {
                    MainShell(
                        state = state,
                        services = vm.local,
                        daily = vm.daily,
                        memory = vm.memory,
                        dogtalk = vm.dogtalk,
                        devHands = devHands,
                        archive = vm.archive,
                        crossWindowRepository = vm.crossWindowRepository,
                        crossWindow = crossWindow,
                        onCrossWindowChange = vm::updateCrossWindow,
                        onOpenRoomType = vm::openRoomType,
                        onSelectConversation = vm::selectConversation,
                        onNewConversation = vm::newConversation,
                        onRenameConversation = vm::renameConversation,
                        onDeleteConversation = vm::deleteConversation,
                        onSelectTheme = { preset ->
                            vm.local.wolf.setTheme(preset)
                            vm.syncAppearance()
                        },
                        onOpenFeature = vm::openFeature,
                        onBackToChat = vm::backToChat,
                        onRefresh = vm::refreshCoastState,
                        onUpdateModelPartnerAvatar = vm::updateModelPartnerAvatar,
                        onUploadAttachment = vm::uploadAttachment,
                        onRemovePendingAttachment = vm::removePendingAttachment,
                        onSend = vm::sendMessage,
                        onStop = vm::stopGeneration,
                        onMessageAction = vm::handleMessageAction,
                        onOpenActionLog = vm::openActionLog,
                        onImportMessages = vm::importMessages,
                        onLocalActionLogged = vm::logLocalAction,
                        onOpenModels = vm::openModelPicker,
                        onDismissModels = vm::dismissModelPicker,
                        onSelectModel = vm::selectModel,
                        onRefreshModels = vm::refreshModels,
                        onLogout = vm::logout,
                        onPlaceholder = vm::showPlaceholder,
                        onSnackbarShown = vm::clearSnackbar
                    )
                }
            }
        }
    }
}
