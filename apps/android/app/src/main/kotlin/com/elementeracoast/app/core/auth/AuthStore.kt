package com.elementeracoast.app.core.auth

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

interface AuthStore {
    fun load(): AuthSession?
    fun save(session: AuthSession)
    fun clear()
}

class MemoryAuthStore(initial: AuthSession? = null) : AuthStore {
    private var value = initial
    override fun load(): AuthSession? = value
    override fun save(session: AuthSession) { value = session }
    override fun clear() { value = null }
}

class AndroidKeystoreAuthStore(context: Context) : AuthStore {
    private val preferences = context.applicationContext
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override fun load(): AuthSession? {
        val encoded = preferences.getString(KEY_SESSION, null) ?: return null
        return runCatching {
            val payload = Base64.decode(encoded, Base64.NO_WRAP)
            require(payload.size > IV_SIZE)
            val iv = payload.copyOfRange(0, IV_SIZE)
            val ciphertext = payload.copyOfRange(IV_SIZE, payload.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            val plaintext = String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
            val separator = plaintext.indexOf('\n')
            require(separator > 0)
            val expires = plaintext.substring(0, separator).toLong()
            val cookie = plaintext.substring(separator + 1)
            require(cookie.startsWith("$COOKIE_NAME="))
            AuthSession(cookie, expires)
        }.getOrElse {
            preferences.edit().remove(KEY_SESSION).apply()
            null
        }
    }

    override fun save(session: AuthSession) {
        require(session.cookieHeader.startsWith("$COOKIE_NAME="))
        val plaintext = "${session.expiresAtEpochSeconds}\n${session.cookieHeader}"
            .toByteArray(StandardCharsets.UTF_8)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(plaintext)
        val combined = cipher.iv + encrypted
        preferences.edit()
            .putString(KEY_SESSION, Base64.encodeToString(combined, Base64.NO_WRAP))
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
        const val COOKIE_NAME = "__Host-coast_session"
        private const val PREFERENCES_NAME = "elementera_native_auth"
        private const val KEY_SESSION = "coast.session.v1"
        private const val KEY_ALIAS = "elementera_coast_session_key_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
    }
}
