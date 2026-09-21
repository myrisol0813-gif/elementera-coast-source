package com.elementeracoast.app.core.auth

import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException

interface AuthRepository {
    suspend fun login(password: String): AuthSession
    suspend fun restore(): SessionRestoreResult
    suspend fun logout()
    fun current(): AuthSession?
    fun clearConfirmedInvalidSession()
}

class DefaultAuthRepository(
    private val store: AuthStore,
    private val api: CoastApiClient
) : AuthRepository {
    override suspend fun login(password: String): AuthSession {
        val session = api.login(password)
        store.save(session)
        return session
    }

    override suspend fun restore(): SessionRestoreResult {
        val session = store.load() ?: return SessionRestoreResult.Missing
        if (session.isExpired()) {
            store.clear()
            return SessionRestoreResult.Invalid("登录状态已过期，请重新输入访问密码。")
        }
        return try {
            val response = api.getSession(session)
            if (!response.authenticated) {
                store.clear()
                SessionRestoreResult.Invalid("登录状态已失效，请重新进入海岸。")
            } else {
                val refreshed = session.copy(
                    expiresAtEpochSeconds = if (response.persistsUntilLogout) 0L else response.expiresAt
                )
                store.save(refreshed)
                SessionRestoreResult.Restored(refreshed)
            }
        } catch (error: CoastApiException) {
            if (error.kind == CoastApiErrorKind.Unauthorized) {
                store.clear()
                SessionRestoreResult.Invalid("登录状态已失效，请重新进入海岸。")
            } else {
                SessionRestoreResult.Offline(session, error.message)
            }
        }
    }

    override suspend fun logout() {
        val session = store.load()
        runCatching { api.logout(session) }
        store.clear()
    }

    override fun current(): AuthSession? = store.load()

    override fun clearConfirmedInvalidSession() = store.clear()
}
