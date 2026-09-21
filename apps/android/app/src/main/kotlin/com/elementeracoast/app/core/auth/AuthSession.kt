package com.elementeracoast.app.core.auth

data class AuthSession(
    val cookieHeader: String,
    val expiresAtEpochSeconds: Long
) {
    fun isExpired(nowEpochSeconds: Long = System.currentTimeMillis() / 1000L): Boolean =
        expiresAtEpochSeconds > 0L && expiresAtEpochSeconds <= nowEpochSeconds
}

sealed interface SessionRestoreResult {
    data class Restored(val session: AuthSession) : SessionRestoreResult
    data class Offline(val session: AuthSession, val message: String) : SessionRestoreResult
    data object Missing : SessionRestoreResult
    data class Invalid(val message: String) : SessionRestoreResult
}
