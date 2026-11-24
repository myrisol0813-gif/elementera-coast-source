package com.elementeracoast.app.core.local

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest

/**
 * Workspace selection is device-only, separate from the server session.
 * Capture the selected transport before composing screens. Switching workspaces
 * creates a fresh Activity/ViewModel; old clients retain their original transport.
 */
object NativeWorkspace {
    private const val PREFS = "elementera_workspace_selection"
    private const val KEY = "local_mode"
    @Volatile private var current: LocalCoastTransport? = null
    @Volatile private var localStore: LocalPersistence? = null

    val isLocal: Boolean get() = current != null
    val transport: LocalCoastTransport? get() = current
    fun persistence(context: Context): LocalPersistence =
        localStore ?: SharedPreferencesLocalPersistence(context)

    @Synchronized fun initialize(context: Context) {
        val local = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY, false)
        if (local) {
            if (current != null) return // configuration change: retain the same store and transport
            val store = FileLocalPersistence(File(context.noBackupFilesDir, "coast-local-v1"))
            localStore = store
            current = LocalCoastTransport(store) { LocalProviderStore(context).catalog() }
        } else {
            current = null
            localStore = null
        }
    }

    fun select(context: Context, local: Boolean): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY, local).commit()
}

/** Separate app-private, atomic file storage; never shares online cache keys/files. */
class FileLocalPersistence(private val root: File) : LocalPersistence {
    private fun file(key: String): AtomicFile {
        check(root.isDirectory || root.mkdirs()) { "无法创建本机存储目录" }
        val name = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        return AtomicFile(File(root, name))
    }

    @Synchronized override fun get(key: String, default: String): String =
        try { file(key).readFully().toString(Charsets.UTF_8) }
        catch (_: FileNotFoundException) { default }

    @Synchronized override fun put(key: String, value: String) {
        val target = file(key)
        val stream = target.startWrite()
        try {
            stream.write(value.toByteArray(Charsets.UTF_8))
            target.finishWrite(stream)
        } catch (error: Exception) {
            target.failWrite(stream)
            throw error
        }
    }

    @Synchronized override fun remove(key: String) { file(key).delete() }
}
