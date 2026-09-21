package com.elementeracoast.app.core.network

import com.elementeracoast.app.BuildConfig

data class CoastApiConfig(val baseUrl: String) {
    val normalizedBaseUrl: String = baseUrl.trimEnd('/')
    val origin: String = normalizedBaseUrl
    fun url(path: String): String = "$normalizedBaseUrl/${path.trimStart('/')}"

    companion object {
        fun production(): CoastApiConfig = CoastApiConfig(BuildConfig.COAST_API_BASE_URL)
    }
}
