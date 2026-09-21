package com.elementeracoast.app.core.local

import android.content.Context

/** Small key/value boundary for Native-only persistence. No network and no compatibility layer. */
interface LocalPersistence {
    fun get(key: String, default: String = ""): String
    fun put(key: String, value: String)
    fun remove(key: String)
}

class MemoryLocalPersistence : LocalPersistence {
    private val values = linkedMapOf<String, String>()

    override fun get(key: String, default: String): String = values[key] ?: default
    override fun put(key: String, value: String) { values[key] = value }
    override fun remove(key: String) { values.remove(key) }
}

class SharedPreferencesLocalPersistence(context: Context) : LocalPersistence {
    private val preferences = context.applicationContext
        .getSharedPreferences("elementera_native_local", Context.MODE_PRIVATE)

    override fun get(key: String, default: String): String = preferences.getString(key, default) ?: default
    override fun put(key: String, value: String) { preferences.edit().putString(key, value).apply() }
    override fun remove(key: String) { preferences.edit().remove(key).apply() }
}
