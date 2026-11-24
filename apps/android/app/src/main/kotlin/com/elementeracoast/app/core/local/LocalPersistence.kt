package com.elementeracoast.app.core.local

import android.content.Context

/** Small key/value boundary for Native-only persistence. No network and no compatibility layer. */
interface LocalPersistence {
    fun get(key: String, default: String = ""): String
    fun put(key: String, value: String)
    fun remove(key: String)
    fun getBinary(key:String):ByteArray?=error("当前工作区不支持原件存储。")
    fun putBinary(key:String,value:ByteArray):Unit=error("当前工作区不支持原件存储。")
    fun <T> readConsistent(block: (LocalPersistence) -> T): T = block(this)
    fun <T> atomic(block: (LocalPersistence) -> T): T = error("当前工作区不支持本机恢复事务。")
}

class MemoryLocalPersistence : LocalPersistence {
    private val values = linkedMapOf<String, String>()

    @Synchronized override fun get(key: String, default: String): String = values[key] ?: default
    @Synchronized override fun put(key: String, value: String) { values[key] = value }
    @Synchronized override fun remove(key: String) { values.remove(key) }
    @Synchronized override fun getBinary(key:String):ByteArray?=values[key]?.let{java.util.Base64.getDecoder().decode(it)}
    @Synchronized override fun putBinary(key:String,value:ByteArray){values[key]=java.util.Base64.getEncoder().encodeToString(value)}
    @Synchronized override fun <T> readConsistent(block: (LocalPersistence) -> T): T = block(this)
    @Synchronized override fun <T> atomic(block: (LocalPersistence) -> T): T {
        val staged = MemoryLocalPersistence()
        staged.values.putAll(values)
        val result = block(staged)
        values.clear(); values.putAll(staged.values)
        return result
    }
}

class SharedPreferencesLocalPersistence(context: Context) : LocalPersistence {
    private val preferences = context.applicationContext
        .getSharedPreferences("elementera_native_local", Context.MODE_PRIVATE)

    override fun get(key: String, default: String): String = preferences.getString(key, default) ?: default
    override fun put(key: String, value: String) { preferences.edit().putString(key, value).apply() }
    override fun remove(key: String) { preferences.edit().remove(key).apply() }
}
