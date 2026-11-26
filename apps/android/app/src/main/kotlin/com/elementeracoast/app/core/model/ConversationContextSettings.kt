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

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class ConversationContextSettings(
    @SerialName("reality_enabled") val realityEnabled: Boolean = false,
    @SerialName("reality_fields") val realityFields: List<String> = emptyList(),
    @SerialName("short_reply_mode") val shortReplyMode: Boolean = false,
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
    @SerialName("sticker_add_enabled") val stickerAddEnabled: Boolean = false
) {
    fun normalized(): ConversationContextSettings = copy(
        realityFields = realityFields.filter(RealityContextFields.all::contains).distinct(),
        weatherCity = weatherCity.replace(Regex("[\\r\\n\\t]+"), " ").trim().take(80)
    )

    fun has(field: String): Boolean = realityEnabled && field in realityFields
}
