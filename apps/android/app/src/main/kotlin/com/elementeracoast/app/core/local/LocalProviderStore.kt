package com.elementeracoast.app.core.local

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import com.elementeracoast.app.core.remote.RemoteModelCatalogResponse
import com.elementeracoast.app.core.remote.RemoteModelCatalogItem
import com.elementeracoast.app.core.remote.RemoteModelGroups

@Serializable
data class LocalProviderConfig(
    val id: String,
    val name: String,
    val baseUrl: String,
    val apiKey: String,
    val models: List<String> = emptyList()
) {
    fun modelId(model: String) = "local:" + id + "/" + model
    override fun toString(): String = "LocalProviderConfig(id=$id, credentials=redacted)"
}

/** Deliberately separate from workspace snapshots, online profile and OAuth credentials. */
class LocalProviderStore(context: Context, searchOnly:Boolean=false, voiceOnly:Boolean=false) {
    private val alias=if(voiceOnly) "coast_local_voice_aes_v1" else if(searchOnly) "coast_local_search_aes_v1" else ALIAS
    private val prefs = context.applicationContext.getSharedPreferences(if(voiceOnly) "coast_local_voice_v1" else if(searchOnly) "coast_local_search_v1" else "coast_local_providers_v1", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    @Synchronized fun load(): List<LocalProviderConfig> {
        val raw = prefs.getString("providers", null) ?: return emptyList()
        return try {
            val bytes = Base64.decode(raw, Base64.NO_WRAP)
            require(bytes.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            json.decodeFromString<List<LocalProviderConfig>>(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (_: Exception) {
            error("本机供应商凭据无法解密；未覆盖原资料。")
        }
    }

    @Synchronized fun upsert(value: LocalProviderConfig) {
        require(value.name.isNotBlank() && value.apiKey.isNotBlank()) { "请填写名称及 API Key。" }
        val normalized = value.copy(baseUrl = normalizeLocalProviderUrl(value.baseUrl),
            models = value.models.map(String::trim).filter(String::isNotBlank).distinct().take(3000))
        val old = load()
        save(if (old.any { it.id == value.id }) old.map { if (it.id == value.id) normalized else it } else old + normalized)
    }

    @Synchronized fun remove(id: String) = save(load().filterNot { it.id == id })

    fun resolve(modelId: String): Pair<LocalProviderConfig, String>? {
        val id = modelId.removePrefix("local:").substringBefore('/')
        if (!modelId.startsWith("local:") || '/' !in modelId) return null
        val provider = load().firstOrNull { it.id == id } ?: return null
        val model = modelId.substringAfter('/')
        return if (model in provider.models) provider to model else null
    }

    // Image API selection is namespaced by the same existing provider ID.
    // Never route credentials for arbitrary endpoints to OpenRouter.
    fun resolveImageProvider(selected:String):LocalProviderConfig? {
        if(!selected.startsWith("local:")||'/' !in selected)return null
        val provider=load().firstOrNull{it.id==selected.removePrefix("local:").substringBefore('/')&&it.baseUrl.trimEnd('/')=="https://openrouter.ai/api/v1"}?:return null
        val raw=selected.substringAfter('/')
        if(!Regex("[a-z0-9][a-z0-9_.-]{0,79}/[a-z0-9][a-z0-9_.-]{0,119}(:free)?",RegexOption.IGNORE_CASE).matches(raw))return null
        return provider.copy(models=listOf(raw))
    }

    fun catalog(): RemoteModelCatalogResponse {
        val providers=load()
        val chat=mutableListOf<RemoteModelCatalogItem>()
        val images=mutableListOf<RemoteModelCatalogItem>()
        for(p in providers){
            val directory=if(p.baseUrl.trimEnd('/')=="https://openrouter.ai/api/v1")runCatching{LocalImageProvider().discover(p.apiKey)}.getOrNull()else null
            val imageIds=directory.orEmpty().map{it.id}.toSet()
            chat+=p.models.filterNot{it in imageIds}.map{RemoteModelCatalogItem(p.modelId(it),p.name+" · "+it)}
            images+=directory.orEmpty().map{RemoteModelCatalogItem(p.modelId(it.id),p.name+" · "+it.name)}
        }
        return RemoteModelCatalogResponse(ok=true,groups=RemoteModelGroups(openAiChat=chat,openAiImage=images))
    }

    private fun save(values: List<LocalProviderConfig>) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(json.encodeToString(values).toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("providers", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }

    companion object { private const val ALIAS = "coast_local_provider_aes_v1" }
}

internal fun normalizeLocalProviderUrl(raw: String): String {
    val parsed = raw.trim().toHttpUrlOrNull() ?: error("请输入完整 HTTPS API Base URL。")
    require(parsed.isHttps && parsed.username.isEmpty() && parsed.password.isEmpty() &&
        parsed.query == null && parsed.fragment == null) {
        "API URL 必须使用 HTTPS，且不能包含账号、密码、查询参数或片段。"
    }
    require(!parsed.host.endsWith(".invalid")) { "请选择真实的模型服务地址。" }
    require(!parsed.encodedPath.trimEnd('/').endsWith("/chat/completions") &&
        !parsed.encodedPath.trimEnd('/').endsWith("/models")) { "填写 Base URL，不要包含 /chat/completions 或 /models。" }
    return parsed.toString().trimEnd('/')
}
