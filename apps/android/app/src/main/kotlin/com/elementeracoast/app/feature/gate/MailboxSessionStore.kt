package com.elementeracoast.app.feature.gate

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface MailboxSessionStore {
    fun load(): String?
    fun save(cookieHeader: String)
    fun clear()
}

class MemoryMailboxSessionStore(initial: String? = null) : MailboxSessionStore {
    private var value = initial
    override fun load(): String? = value
    override fun save(cookieHeader: String) { value = cookieHeader }
    override fun clear() { value = null }
}

class AndroidMailboxSessionStore(context: Context) : MailboxSessionStore {
    private val preferences = context.applicationContext
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override fun load(): String? {
        val encoded = preferences.getString(KEY_SESSION, null) ?: return null
        return runCatching {
            val payload = Base64.decode(encoded, Base64.NO_WRAP)
            require(payload.size > IV_SIZE)
            val iv = payload.copyOfRange(0, IV_SIZE)
            val ciphertext = payload.copyOfRange(IV_SIZE, payload.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            val cookie = String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
            require(cookie.startsWith("$COOKIE_NAME="))
            cookie
        }.getOrElse {
            preferences.edit().remove(KEY_SESSION).apply()
            null
        }
    }

    override fun save(cookieHeader: String) {
        require(cookieHeader.startsWith("$COOKIE_NAME="))
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(cookieHeader.toByteArray(StandardCharsets.UTF_8))
        preferences.edit()
            .putString(KEY_SESSION, Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP))
            .apply()
    }

    override fun clear() {
        preferences.edit().remove(KEY_SESSION).apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        const val COOKIE_NAME = "__Host-coast_mailbox"
        private const val PREFERENCES_NAME = "elementera_native_mailbox_auth"
        private const val KEY_SESSION = "mailbox.session.v1"
        private const val KEY_ALIAS = "elementera_coast_mailbox_session_key_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
    }
}
