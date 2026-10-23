package com.elementeracoast.app.feature.chatgpt

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class ChatGptConnection(
    val clientId: String,
    val hostId: String,
    val subject: String,
    val email: String,
    val idToken: String,
    val accessToken: String,
    val refreshToken: String,
    val scopes: List<String>,
    val expiresAtEpochSeconds: Long
)

/** This store is device-only, encrypted with a separate Android Keystore key.
 * It must never be synchronized with the Coast backend, archive, or APK logs.
 */
class ChatGptSecureStore(context: Context) {
    private val preferences = context.applicationContext
        .getSharedPreferences("coast_chatgpt_account", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun hostId(): String {
        preferences.getString(HOST_ID, null)?.takeIf(String::isNotBlank)?.let { return it }
        val host = "urn:uuid:" + UUID.randomUUID().toString()
        check(preferences.edit().putString(HOST_ID, host).commit())
        return host
    }

    fun load(): ChatGptConnection? {
        val encoded = preferences.getString(CREDENTIALS, null) ?: return null
        return runCatching {
            val all = Base64.decode(encoded, Base64.NO_WRAP)
            require(all.size > IV_BYTES)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE, key(),
                GCMParameterSpec(128, all.copyOfRange(0, IV_BYTES))
            )
            json.decodeFromString<ChatGptConnection>(
                String(cipher.doFinal(all.copyOfRange(IV_BYTES, all.size)), Charsets.UTF_8)
            )
        }.getOrElse {
            // Corrupt or invalidated credentials cannot be used, and are not logged.
            preferences.edit().remove(CREDENTIALS).commit()
            null
        }
    }

    fun save(value: ChatGptConnection) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(json.encodeToString(value).toByteArray(Charsets.UTF_8))
        check(preferences.edit()
            .putString(CREDENTIALS, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .commit())
    }

    fun preferredModel(): String? = preferences.getString(PREFERRED_MODEL, null)?.takeIf(String::isNotBlank)

    fun selectModel(modelSlug: String?) {
        check(preferences.edit().apply {
            if (modelSlug.isNullOrBlank()) remove(PREFERRED_MODEL)
            else putString(PREFERRED_MODEL, modelSlug)
        }.commit())
    }

    fun clear() {
        check(preferences.edit().remove(CREDENTIALS).remove(PREFERRED_MODEL).commit())
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return gen.generateKey()
    }

    companion object {
        private const val HOST_ID = "installation.host.id"
        private const val CREDENTIALS = "credentials.v1"
        private const val PREFERRED_MODEL = "chat.selected.model.v1"
        private const val ALIAS = "coast_chatgpt_tokens_aes_gcm_v1"
        private const val IV_BYTES = 12
    }
}
