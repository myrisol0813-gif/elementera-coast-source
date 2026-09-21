package com.elementeracoast.app.feature.serpentdesk

import android.content.Context
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastHttpClient

object DevHandsProvider {
    fun production(context: Context): DevHandsRepository {
        val appContext = context.applicationContext
        val authStore = AndroidKeystoreAuthStore(appContext)
        val config = CoastApiConfig.production()
        val http = CoastHttpClient(config, authStore).client
        return DefaultDevHandsRepository(config, http)
    }
}
