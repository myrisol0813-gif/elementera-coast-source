package com.elementeracoast.app.feature.shell

/** Process-local lease only. No prompt, provider credential or replayable task. */
internal class GenerationLeaseRegistry {
    data class Lease(val token: String, val cancel: () -> Unit, val unavailable: () -> Unit)
    private var active: Lease? = null
    @Synchronized fun acquire(lease: Lease): Boolean {
        if (active != null) return false
        active = lease
        return true
    }
    @Synchronized fun current(): Lease? = active
    @Synchronized fun release(token: String): Boolean {
        if (active?.token != token) return false
        active = null
        return true
    }
    fun cancel(token: String) {
        val lease = current()
        if (lease?.token == token) lease.cancel()
    }
}
