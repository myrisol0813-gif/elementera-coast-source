package com.elementeracoast.app.feature.dogtalk

val DogtalkContractFields = listOf("body", "true_core", "weather", "read_mode")

data class DogtalkUiState(
    val body: String = "",
    val trueCore: String = "",
    val weather: String = "",
    val readMode: DogtalkReadMode = DogtalkReadMode.KeepPrivate
)
