package com.elementeracoast.app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

object RealityContextFields {
    const val DATE = "date"
    const val TIME = "time"
    const val BATTERY = "battery"
    const val WEATHER = "weather"
    const val LOCATION = "location"
    const val RECENT_APP = "recent_app"
    const val APP_USAGE = "app_usage"
    const val CALENDAR = "calendar"
    const val STEPS = "steps"

    val all = listOf(DATE, TIME, BATTERY, WEATHER, LOCATION, RECENT_APP, APP_USAGE, CALENDAR, STEPS)
}

const val DEFAULT_WORKBENCH_PROMPT = "用户欢迎你使用这里为你开放的诸多工具。\n\n你可以依照自己的判断，选择顺手的功能，让它们自然地加入对话、阅读、创作与探索。不必等用户逐项提出要求，也不必为了使用而使用。\n\n希望你用得顺手，也用得开心。"

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class ConversationContextSettings(
    @SerialName("reality_enabled") val realityEnabled: Boolean = false,
    @SerialName("reality_fields") val realityFields: List<String> = emptyList(),
    @SerialName("short_reply_mode") val shortReplyMode: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("workbench_prompt") val workbenchPrompt: String? = null,
    @SerialName("weather_city") val weatherCity: String = "",
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("cross_window_auto") val crossWindowAuto: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("local_model_tools_enabled") val localModelToolsEnabled: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("local_model_write_enabled") val localModelWriteEnabled: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("sticker_send_enabled") val stickerSendEnabled: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("sticker_add_enabled") val stickerAddEnabled: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("reply_sequence_enabled") val replySequenceEnabled: Boolean = false,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("reply_sequence_max_messages") val replySequenceMaxMessages: Int? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("reply_sequence_tool_budget") val replySequenceToolBudget: Int? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER)
    @SerialName("reply_sequence_token_budget") val replySequenceTokenBudget: Int? = null
) {
    fun normalized(): ConversationContextSettings = copy(
        realityFields = realityFields.filter(RealityContextFields.all::contains).distinct(),
        workbenchPrompt = workbenchPrompt?.take(4000),
        replySequenceMaxMessages = replySequenceMaxMessages?.takeIf { it in 1..20 },
        replySequenceToolBudget = replySequenceToolBudget?.takeIf { it in 0..128 },
        replySequenceTokenBudget = replySequenceTokenBudget?.takeIf { it in 1..1000000 },
        weatherCity = weatherCity.replace(Regex("[\\r\\n\\t]+"), " ").trim().take(80)
    )

    fun has(field: String): Boolean = realityEnabled && field in realityFields
}
