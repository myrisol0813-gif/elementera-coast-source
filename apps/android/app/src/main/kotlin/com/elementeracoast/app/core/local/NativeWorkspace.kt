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

/** One authoritative generation. Restore writes into a private staged directory, then switches a single atomic pointer. */
class FileLocalPersistence(private val root: File, private val allowTransactions: Boolean = true) : LocalPersistence {
    private val generationName = Regex("generation-[0-9a-f-]{36}")
    private val keyName = Regex("[0-9a-f]{64}")
    private fun ensureRoot() { check(root.isDirectory || root.mkdirs()) { "无法创建本机存储目录" } }
    private fun pointer() = AtomicFile(File(root, "active-generation"))
    private fun activeRoot(): File {
        ensureRoot()
        val name = try { pointer().readFully().toString(Charsets.UTF_8) }
        catch (_: FileNotFoundException) { return root }
        check(generationName.matches(name)) { "本机资料目录索引损坏；未回退到旧资料。" }
        return File(root, name).also { check(it.isDirectory) { "本机资料目录缺失；未回退到旧资料。" } }
    }
    private fun file(key: String): AtomicFile {
        val name = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        return AtomicFile(File(activeRoot(), name))
    }
    private fun writeAtomic(target: AtomicFile, bytes: ByteArray) {
        val stream = target.startWrite()
        try { stream.write(bytes); target.finishWrite(stream) }
        catch (error: Exception) { target.failWrite(stream); throw error }
        check(target.readFully().contentEquals(bytes)) { "本机写入校验失败。" }
    }
    @Synchronized override fun get(key: String, default: String): String =
        try { file(key).readFully().toString(Charsets.UTF_8) }
        catch (_: FileNotFoundException) { default }
    @Synchronized override fun put(key: String, value: String) = writeAtomic(file(key), value.toByteArray(Charsets.UTF_8))
    @Synchronized override fun remove(key: String) { file(key).delete() }
    @Synchronized override fun getBinary(key:String):ByteArray?=try{file(key).readFully()}catch(_:FileNotFoundException){null}
    @Synchronized override fun putBinary(key:String,value:ByteArray)=writeAtomic(file(key),value)
    @Synchronized override fun <T> readConsistent(block: (LocalPersistence) -> T): T = block(this)

    @Synchronized override fun <T> atomic(block: (LocalPersistence) -> T): T {
        check(allowTransactions) { "不允许嵌套恢复事务。" }
        val old = activeRoot()
        val stage = File(root, "generation-" + java.util.UUID.randomUUID())
        check(stage.mkdir()) { "无法创建本机恢复暂存目录。" }
        try {
            val names = requireNotNull(old.listFiles()) { "无法读取本机存储目录。" }
                .map { it.name.removeSuffix(".bak").removeSuffix(".new") }
                .filter(keyName::matches).distinct()
            for (name in names) {
                val original = AtomicFile(File(old, name))
                val value = try { original.readFully() }
                catch (_: FileNotFoundException) { continue }
                writeAtomic(AtomicFile(File(stage, name)), value)
            }
            val result = block(FileLocalPersistence(stage, allowTransactions = false))
            writeAtomic(pointer(), stage.name.toByteArray(Charsets.UTF_8))
            check(activeRoot() == stage) { "恢复索引未生效。" }
            // Retain the immediately previous generation; other abandoned stages are not authorities.
            root.listFiles()?.filter { it.isDirectory && generationName.matches(it.name) && it != old && it != stage }
                ?.forEach { runCatching { it.deleteRecursively() } }
            return result
        } catch (error: Exception) {
            // Never remove a stage if pointer publication may have succeeded.
            if (runCatching { activeRoot() != stage }.getOrDefault(false)) runCatching { stage.deleteRecursively() }
            throw error
        }
    }
}
