package com.elementeracoast.app.core.tour

import com.elementeracoast.app.BuildConfig

/**
 * Removable visitor doorway for the public Source Native APK, NOT an authenticated session.
 *
 * Enabled with -PSOURCE_TOUR_ENABLED=true (the Source default). Disable it at build time
 * to recover the original server-login-only app without rewriting any existing page.
 *
 * The public passcode is only a UI gesture, never a secret or backend credential.
 * Source HTTP traffic is blocked while the visitor is inside.
 */
object SourceVisitGate {
    const val PUBLIC_PASSCODE = "123456"
    const val SESSION_KIND = "source_tour"

    val enabled: Boolean get() = BuildConfig.SOURCE_TOUR_ENABLED

    @Volatile private var visiting = false

    val isActive: Boolean get() = enabled && visiting

    fun open(passcode: String): Boolean {
        if (!enabled || passcode != PUBLIC_PASSCODE) return false
        visiting = true
        return true
    }

    fun leave() {
        visiting = false
    }

    fun shouldBlockRemoteRequest(): Boolean = isActive
}
