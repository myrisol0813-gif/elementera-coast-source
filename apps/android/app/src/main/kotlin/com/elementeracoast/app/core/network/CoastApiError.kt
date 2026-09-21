package com.elementeracoast.app.core.network

enum class CoastApiErrorKind {
    Unauthorized,
    Network,
    Server,
    Model,
    Stream,
    Decode,
    NotFound,
    Request
}

class CoastApiException(
    val kind: CoastApiErrorKind,
    val type: String,
    override val message: String,
    val status: Int = 0,
    cause: Throwable? = null
) : Exception(message, cause)

internal fun coastErrorKind(status: Int, type: String): CoastApiErrorKind = when {
    status == 401 -> CoastApiErrorKind.Unauthorized
    status == 404 || type == "conversation_not_found" -> CoastApiErrorKind.NotFound
    type.contains("stream", ignoreCase = true) -> CoastApiErrorKind.Stream
    type.contains("provider", ignoreCase = true) || type.contains("model", ignoreCase = true) -> CoastApiErrorKind.Model
    status >= 500 -> CoastApiErrorKind.Server
    else -> CoastApiErrorKind.Request
}
