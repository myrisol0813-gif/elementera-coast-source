package com.elementeracoast.app.feature.daily

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream

private const val STUDIO_HOST = "rest-studio.invalid"
private const val STUDIO_HOME = "https://rest-studio.invalid/rest-box/room-lab.html"
private const val MAX_STUDIO_JSON = 1_000_000

/** Only immutable bundled art and code. No application network, cookies, or model bridge. */
internal fun studioAssetPath(uri: Uri): String? {
    if (uri.scheme != "https" || uri.host != STUDIO_HOST || uri.port != -1 ||
        uri.userInfo != null || uri.query != null || uri.fragment != null) return null
    val path = uri.path ?: return null
    if (!path.startsWith("/rest-box/") || path.split('/').any { it == "." || it == ".." } ||
        path.contains('\\') || !path.matches(Regex("/rest-box/[A-Za-z0-9_./-]+"))) return null
    return path.removePrefix("/").takeIf {
        it == "rest-box/room-lab.html" || it.matches(Regex("rest-box/[a-z-]+[.]mjs")) ||
            (it.startsWith("rest-box/art/v1/") && (it.endsWith(".svg") || it.endsWith(".json")))
    }
}

private class StudioExportBridge(private val export: (String) -> Unit) {
    @JavascriptInterface fun exportLayout(json: String) {
        if (json.length > MAX_STUDIO_JSON || json.toByteArray(Charsets.UTF_8).size > MAX_STUDIO_JSON) return
        Handler(Looper.getMainLooper()).post { export(json) }
    }
}

@Composable
internal fun PetScreen() {
    val context = LocalContext.current
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var pendingExport by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileCallback = null
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val json = pendingExport
        pendingExport = null
        if (uri != null && json != null) {
            try {
                context.contentResolver.openOutputStream(uri, "wt")?.use {
                    it.write(json.toByteArray(Charsets.UTF_8))
                } ?: error("No output stream")
                android.widget.Toast.makeText(context, "造物间已导出", android.widget.Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                android.widget.Toast.makeText(context, "导出失败，请重试", android.widget.Toast.LENGTH_SHORT).show()
            }
        }
    }
    val view = remember(context) {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true // user-picked document only; no content navigation
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.toString() != STUDIO_HOME

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    val path = if (request.method == "GET") studioAssetPath(request.url) else null
                    if (path != null) {
                        try {
                            val mime = when {
                                path.endsWith(".mjs") -> "text/javascript"
                                path.endsWith(".json") -> "application/json"
                                path.endsWith(".svg") -> "image/svg+xml"
                                else -> "text/html"
                            }
                            return WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf(
                                "Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
                                "X-Content-Type-Options" to "nosniff"
                            ), context.assets.open(path))
                        } catch (_: Exception) { }
                    }
                    return WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    try { pick.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }
                    catch (_: Exception) { fileCallback?.onReceiveValue(null); fileCallback = null }
                    return true
                }
            }
            addJavascriptInterface(StudioExportBridge { json ->
                if (pendingExport == null) {
                    pendingExport = json
                    try { save.launch("rest-box-layout.json") } catch (_: Exception) { pendingExport = null }
                }
            }, "RestStudioFiles")
            loadUrl(STUDIO_HOME)
        }
    }
    DisposableEffect(view) {
        onDispose {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            view.removeJavascriptInterface("RestStudioFiles")
            view.stopLoading()
            view.destroy()
        }
    }
    AndroidView(factory = { view }, modifier = Modifier.fillMaxSize())
}
