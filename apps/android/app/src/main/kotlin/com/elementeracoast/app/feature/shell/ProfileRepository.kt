package com.elementeracoast.app.feature.shell

import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.remote.RemoteCacheStore
import com.elementeracoast.app.core.remote.RemoteModelCatalogResponse
import com.elementeracoast.app.core.remote.RemoteProfile

interface ProfileRepository {
    fun cachedProfile(): RemoteProfile?
    fun cachedModels(): RemoteModelCatalogResponse?
    suspend fun refreshProfile(): RemoteProfile
    suspend fun refreshModels(force: Boolean = false): RemoteModelCatalogResponse
    suspend fun setCurrentChatModel(modelId: String): RemoteProfile
    suspend fun setAssistantAvatar(dataUrl: String): RemoteProfile
}

class DefaultProfileRepository(
    private val api: CoastApiClient,
    private val cache: RemoteCacheStore
) : ProfileRepository {
    override fun cachedProfile(): RemoteProfile? = cache.profile()
    override fun cachedModels(): RemoteModelCatalogResponse? = cache.modelCatalog()

    override suspend fun refreshProfile(): RemoteProfile = api.getProfile().also(cache::putProfile)
    override suspend fun refreshModels(force: Boolean): RemoteModelCatalogResponse = api.listModels(force).also(cache::putModelCatalog)

    override suspend fun setCurrentChatModel(modelId: String): RemoteProfile = updateProfile { current ->
        current.copy(currentChatModel = modelId)
    }

    override suspend fun setAssistantAvatar(dataUrl: String): RemoteProfile = updateProfile { current ->
        current.copy(assistantAvatarDataUrl = dataUrl)
    }

    private suspend fun updateProfile(transform: (RemoteProfile) -> RemoteProfile): RemoteProfile {
        val current = refreshProfile()
        val updated = api.putProfile(transform(current))
        cache.putProfile(updated)
        return updated
    }
}
