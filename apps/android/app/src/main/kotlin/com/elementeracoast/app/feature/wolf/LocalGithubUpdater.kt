package com.elementeracoast.app.feature.wolf

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.elementeracoast.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

private const val RELEASE_REPO = "myrisol0813-gif/elementera-coast-source"
private const val SOURCE_CHANNEL = true
private const val MAX_APK = 80L * 1024 * 1024

internal data class GithubReleaseAssets(val tag: String, val apk: String, val notes: String, val order: Long)
internal data class LocalRelease(val assets: GithubReleaseAssets, val version: String, val code: Int, val sha: String)

internal fun selectGithubRelease(releases: JsonArray, source: Boolean): GithubReleaseAssets? {
    val native = Regex("^coast-v1-closeout-native-([0-9]+)$")
    val public = Regex("^source-native-v([0-9]+)\\.([0-9]+)\\.([0-9]+)-[0-9a-f]{40}$")
    fun field(o: JsonObject, key: String) = o[key]?.jsonPrimitive?.contentOrNull.orEmpty()
    return releases.mapNotNull { entry ->
        val obj = entry as? JsonObject ?: return@mapNotNull null
        if (obj["draft"]?.jsonPrimitive?.booleanOrNull == true) return@mapNotNull null
        val tag = field(obj, "tag_name")
        val match = (if (source) public else native).matchEntire(tag) ?: return@mapNotNull null
        val nums = match.groupValues.drop(1).map { it.toLongOrNull() ?: return@mapNotNull null }
        if (nums.any { it !in 0..999999 }) return@mapNotNull null
        val order = if (source) nums[0] * 1000000000000L + nums[1] * 1000000L + nums[2] else nums[0]
        val files = (obj["assets"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { field(it, "name") }
        if (!files.containsAll(listOf("BUILD_INFO.txt", "SHA256SUMS.txt"))) return@mapNotNull null
        val apk = files.singleOrNull { if (source) it == "elementera-coast-source-v${nums.joinToString(".")}-release.apk"
            else it.matches(Regex("CoastGPT-native-[A-Za-z0-9._-]+-debug[.]apk")) } ?: return@mapNotNull null
        GithubReleaseAssets(tag, apk, field(obj, "body").take(4000), order)
    }.maxByOrNull { it.order }
}

internal fun parseLocalRelease(assets: GithubReleaseAssets, info: String, sums: String, appId: String, source: Boolean): LocalRelease {
    val fields = info.lineSequence().filter { '=' in it }.associate { it.substringBefore('=').trim() to it.substringAfter('=').trim() }
    require(fields["applicationId"] == appId) { "发行包名与本机不一致。" }
    require(if (source) fields["certificateSha256"]?.lowercase() == "3e021e11f05b619d603543929e07edd32a037323478a9abfdfe5b405ce6fca59" else fields["stable_signing"] == "true" && fields["signature_verified"] == "true") { "发行签名信息不符合要求。" }
    val code = fields["versionCode"]?.toIntOrNull()?.takeIf { it > 0 } ?: error("发行版本号无效。")
    val version = fields["versionName"]?.takeIf { it.isNotBlank() } ?: error("发行版本名缺失。")
    require(if (source) assets.tag.startsWith("source-native-v${version.removeSuffix("-source")}-") && version.endsWith("-source") else assets.tag == "coast-v1-closeout-native-$code") { "发行标签与版本不一致。" }
    val sha = sums.lineSequence().mapNotNull { Regex("^([0-9a-fA-F]{64})\\s+\\*?(.+)$").matchEntire(it.trim()) }.singleOrNull { it.groupValues[2] == assets.apk }?.groupValues?.get(1)?.lowercase() ?: error("缺少 APK SHA-256。")
    return LocalRelease(assets, version, code, sha)
}

internal class LocalGithubUpdater {
    // Fresh client: never reuse Coast cookies, provider keys, or account authorization.
    private val client = OkHttpClient.Builder().followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private fun asset(a: GithubReleaseAssets, name: String) = "https://github.com/$RELEASE_REPO/releases/download/${a.tag}/$name"
    private fun get(url: String, max: Long): ByteArray {
        client.newCall(Request.Builder().url(url).header("Accept", if (url.startsWith("https://api.github.com/")) "application/vnd.github+json" else "application/octet-stream").build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("GitHub 请求失败（HTTP ${response.code}）。")
            val body = response.body ?: throw IOException("GitHub 未返回文件。")
            if (body.contentLength() > max) throw IOException("发行文件超过大小上限。")
            val out = java.io.ByteArrayOutputStream()
            body.byteStream().use { input ->
                val buffer = ByteArray(8192)
                var total = 0L
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    total += n
                    if (total > max) throw IOException("发行文件超过大小上限。")
                    out.write(buffer, 0, n)
                }
            }
            return out.toByteArray()
        }
    }
    suspend fun latest(): LocalRelease = withContext(Dispatchers.IO) {
        val json = Json.parseToJsonElement(get("https://api.github.com/repos/$RELEASE_REPO/releases?per_page=100", 8L * 1024 * 1024).decodeToString()).jsonArray
        val a = selectGithubRelease(json, SOURCE_CHANNEL) ?: error("未找到完整正式发行包。")
        parseLocalRelease(a, get(asset(a, "BUILD_INFO.txt"), 65536).decodeToString(), get(asset(a, "SHA256SUMS.txt"), 65536).decodeToString(), BuildConfig.APPLICATION_ID, SOURCE_CHANNEL)
    }
    suspend fun download(context: Context, release: LocalRelease): File = withContext(Dispatchers.IO) {
        require(release.code > BuildConfig.VERSION_CODE) { "当前版本无需更新。" }
        val bytes = get(asset(release.assets, release.assets.apk), MAX_APK)
        require(digest(bytes) == release.sha) { "APK SHA-256 校验失败，已停止安装。" }
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, release.assets.apk)
        file.writeBytes(bytes)
        try {
            val pm = context.packageManager
            @Suppress("DEPRECATION")
            val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            @Suppress("DEPRECATION")
            val archive = pm.getPackageArchiveInfo(file.absolutePath, flags) ?: error("无法读取 APK 签名。")
            @Suppress("DEPRECATION")
            val installed = pm.getPackageInfo(context.packageName, flags)
            @Suppress("DEPRECATION")
            val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
            require(archive.packageName == context.packageName && code == release.code.toLong() && archive.versionName == release.version) { "APK 包名或版本不一致。" }
            val old = signatures(installed)
            val new = signatures(archive)
            require(old.isNotEmpty() && old == new) { "签名与本机不一致，不能覆盖安装。请保留旧应用及本机资料。" }
            if (SOURCE_CHANNEL) require(new == setOf("3e021e11f05b619d603543929e07edd32a037323478a9abfdfe5b405ce6fca59")) { "开源发行签名不一致。" }
            file
        } catch (e: Exception) { file.delete(); throw e }
    }
    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> = (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures).orEmpty().map { digest(it.toByteArray()) }.toSet()
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }

    fun openInstaller(context: Context, file: File): Boolean {
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return false
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }
}
