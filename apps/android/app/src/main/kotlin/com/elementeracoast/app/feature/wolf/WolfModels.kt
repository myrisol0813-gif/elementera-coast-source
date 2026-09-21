package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.ui.theme.CoastThemePreset

enum class WolfDestination(val title: String, val subtitle: String) {
    Profile("个人资料", "昵称、聊天署名与显示资料"),
    Appearance("外观", "主题、用户气泡与重点色"),
    Account("账户", "当前登录状态与主动退出"),
    ChatRecords("聊天记录", "导出 JSON / HTML · 导入 JSON"),
    ModelBox("模型箱", "当前模型与 OpenRouter 目录分区"),
    BasicSettings("基本设置", "回答长度、流式输出、记忆召回与世界书"),
    Diagnostics("关于与诊断", "版本、当前房间与本地状态"),
    Update("版本与更新", "PWA cache · Native · APK · SHA-256")
}

data class WolfProfile(
    val nickname: String = "屋主",
    val signature: String = "屋主"
)

data class WolfAppearance(
    val theme: CoastThemePreset = CoastThemePreset.CoastDefault,
    val userBubbleHex: String = "",
    val accentHex: String = ""
)

data class BasicSettings(
    val recentTurns: Int = 8,
    val contextBudget: Int = 6000,
    val outputLength: String = "auto",
    val maxOutputTokens: Int = 8000,
    val creativity: String = "balanced",
    val streamingEnabled: Boolean = true,
    val soilBudget: Int = 1800,
    val seedCooldownTurns: Int = 2,
    val worldbookEnabled: Boolean = true,
    val worldbookLimit: Int = 3,
    val memoryLimit: Int = 8
) {
    companion object {
        val activeFieldNames = listOf(
            "recentTurns", "contextBudget", "outputLength", "maxOutputTokens", "creativity",
            "streamingEnabled", "soilBudget", "seedCooldownTurns", "worldbookEnabled",
            "worldbookLimit", "memoryLimit"
        )
    }
}

data class WolfState(
    val profile: WolfProfile = WolfProfile(),
    val appearance: WolfAppearance = WolfAppearance(),
    val basic: BasicSettings = BasicSettings()
)
