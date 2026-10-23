package com.elementeracoast.app.feature.chatgpt

import java.math.BigInteger
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

internal data class VerifiedChatGptIdentity(val subject: String, val email: String)

/** Verify OpenAI OIDC signatures and claims before an account or its tokens can become active. */
internal class ChatGptIdentityVerifier(private val http: OkHttpClient) {
    private val json = Json { ignoreUnknownKeys = true }

    fun verify(jwt: String, audience: String, nonce: String): VerifiedChatGptIdentity {
        val parts = jwt.split(".")
        require(parts.size == 3) { "Invalid ChatGPT ID token format." }
        val header = parsePart(parts[0])
        require(header["alg"]?.jsonPrimitive?.contentOrNull == "RS256") { "Unexpected ID token algorithm." }
        val keyId = header["kid"]?.jsonPrimitive?.contentOrNull.orEmpty()
        require(keyId.isNotBlank()) { "Missing ID token signing key ID." }

        val request = Request.Builder().url(ChatGptOAuthProtocol.JWKS_ENDPOINT).get().build()
        val jwks = http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Unable to verify ChatGPT identity signing keys." }
            json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
        }
        val keys = (jwks["keys"] as? JsonArray).orEmpty()
        val jwk = keys.mapNotNull { it as? JsonObject }
            .firstOrNull {
                it["kid"]?.jsonPrimitive?.contentOrNull == keyId &&
                    it["kty"]?.jsonPrimitive?.contentOrNull == "RSA"
            } ?: error("ChatGPT signing key not found.")

        fun positiveBase64(name: String): BigInteger =
            BigInteger(1, Base64.getUrlDecoder().decode(jwk[name]?.jsonPrimitive?.content.orEmpty()))
        val key = KeyFactory.getInstance("RSA").generatePublic(
            RSAPublicKeySpec(positiveBase64("n"), positiveBase64("e"))
        )
        val verified = Signature.getInstance("SHA256withRSA").run {
            initVerify(key)
            update((parts[0] + "." + parts[1]).toByteArray(Charsets.US_ASCII))
            verify(Base64.getUrlDecoder().decode(parts[2]))
        }
        require(verified) { "ChatGPT identity signature did not validate." }

        val claims = parsePart(parts[1])
        val issuer = claims["iss"]?.jsonPrimitive?.contentOrNull
        require(issuer == "https://auth.openai.com") { "Unexpected ChatGPT identity issuer." }
        val audiences = when (val aud = claims["aud"]) {
            is JsonArray -> aud.mapNotNull { it.jsonPrimitive.contentOrNull }
            else -> listOfNotNull(aud?.jsonPrimitive?.contentOrNull)
        }
        require(audience in audiences) { "ChatGPT identity audience does not match this registration." }
        require(claims["nonce"]?.jsonPrimitive?.contentOrNull == nonce) {
            "ChatGPT identity nonce did not match this attempt."
        }
        val now = System.currentTimeMillis() / 1000
        val expires = claims["exp"]?.jsonPrimitive?.longOrNull ?: 0L
        val issued = claims["iat"]?.jsonPrimitive?.longOrNull ?: 0L
        require(expires > now - 5 && issued in 1..(now + 5)) { "ChatGPT identity token has expired." }
        val subject = claims["sub"]?.jsonPrimitive?.contentOrNull.orEmpty()
        require(subject.isNotBlank()) { "ChatGPT account identity is missing." }
        return VerifiedChatGptIdentity(
            subject = subject,
            email = claims["email"]?.jsonPrimitive?.contentOrNull.orEmpty()
        )
    }

    private fun parsePart(encoded: String): JsonObject =
        json.parseToJsonElement(
            String(Base64.getUrlDecoder().decode(encoded), Charsets.UTF_8)
        ).jsonObject
}
