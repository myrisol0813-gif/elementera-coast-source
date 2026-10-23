package com.elementeracoast.app.feature.chatgpt

data class ChatGptConnectState(
    val connected: Boolean = false,
    val busy: Boolean = false,
    val accountLabel: String = "",
    val availableModels: List<ChatGptAccountModel> = emptyList(),
    val probe: ChatGptProbeResult? = null,
    val message: String = ""
)
