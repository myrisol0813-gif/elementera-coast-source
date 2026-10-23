package com.elementeracoast.app.feature.chatgpt

import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Pure, separately testable PKCE and callback validation for OSS dynamic registration. */
internal object ChatGptOAuthProtocol {
    private const val RESOURCE = "https://api.openai.com/v1"
    const val AUTHORIZE_ENDPOINT = "https://auth.openai.com/api/accounts/authorize"
    const val TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token"
    const val JWKS_ENDPOINT = "https://auth.openai.com/.well-known/jwks.json"
    const val SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    const val CALLBACK_PATH = "/auth/callback"

    fun randomUrlSafe(bytes: Int = 32): String =
        ByteArray(bytes).also { SecureRandom().nextBytes(it) }.let {
            Base64.getUrlEncoder().withoutPadding().encodeToString(it)
        }

    fun challenge(verifier: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        )

    fun authorizationUrl(
        hostId: String,
        redirectUri: String,
        state: String,
        nonce: String,
        challenge: String,
        existing: ChatGptConnection?
    ): String {
        val args = linkedMapOf(
            "client_id" to (existing?.clientId ?: "dynamic_agent_client"),
            "redirect_uri" to redirectUri,
            "response_type" to "code",
            "scope" to SCOPE,
            "resource" to RESOURCE,
            "ext_agent_host_id" to hostId,
            "state" to state,
            "nonce" to nonce,
            "code_challenge_method" to "S256",
            "code_challenge" to challenge
        )
        if (existing == null) args["agent_name_hint"] = "Elementera Coast"
        else {
            args["id_token_hint"] = existing.idToken
            existing.email.takeIf(String::isNotBlank)?.let { args["login_hint"] = it }
        }
        return AUTHORIZE_ENDPOINT + "?" + args.entries.joinToString("&") {
            encode(it.key) + "=" + encode(it.value)
        }
    }

    data class Callback(val code: String, val clientId: String)

    fun verifyCallback(
        rawPath: String,
        expectedState: String,
        existingClientId: String?
    ): Callback {
        val path = rawPath.substringBefore("?")
        require(path == CALLBACK_PATH) { "Unexpected OAuth callback path." }
        val query = rawPath.substringAfter("?", "")
        require(query.length in 1..4096) { "Invalid OAuth callback." }
        val params = query.split("&").filter(String::isNotBlank).map { pair ->
            val k = decode(pair.substringBefore("="))
            val v = decode(pair.substringAfter("=", ""))
            k to v
        }
        require(params.map { it.first }.distinct().size == params.size) { "Duplicate OAuth callback fields." }
        val fields = params.toMap()
        require(fields["state"] == expectedState) { "OAuth state did not match." }
        require(fields["error"].isNullOrBlank()) { "ChatGPT access was not approved." }
        val code = fields["code"].orEmpty()
        require(code.isNotBlank() && code.length <= 2048) { "Missing authorization code." }
        val suppliedClient = fields["client_id"].orEmpty()
        val clientId = if (existingClientId == null) {
            require(suppliedClient.startsWith("oaiapp_")) { "No issued ChatGPT client ID returned." }
            suppliedClient
        } else {
            require(suppliedClient.isEmpty() || suppliedClient == existingClientId) {
                "ChatGPT client identity changed."
            }
            existingClientId
        }
        return Callback(code, clientId)
    }

    const val RESOURCE_URL = RESOURCE
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    private fun decode(value: String) = URLDecoder.decode(value, "UTF-8")
}
