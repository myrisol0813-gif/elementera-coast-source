package com.elementeracoast.app.core.network

import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.core.local.NativeWorkspace
import com.elementeracoast.app.core.local.LocalCoastTransport

data class CoastApiConfig(val baseUrl: String, val localTransport: LocalCoastTransport? = null) {
    val normalizedBaseUrl: String = baseUrl.trimEnd('/')
    val origin: String = normalizedBaseUrl
    fun url(path: String): String = "$normalizedBaseUrl/${path.trimStart('/')}"

    companion object {
        fun production(): CoastApiConfig = NativeWorkspace.transport?.let {
            CoastApiConfig("https://" + LocalCoastTransport.HOST, it)
        } ?: CoastApiConfig(BuildConfig.COAST_API_BASE_URL)
    }
}
