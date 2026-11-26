package com.elementeracoast.app.feature.wolf

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.feature.serpentdesk.DevHandsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun LocalGithubUpdateScreen(onSnackbar: (String) -> Unit, onlineRepository: DevHandsRepository? = null) {
    val context = LocalContext.current
    val updater = remember { LocalGithubUpdater() }
    val scope = rememberCoroutineScope()
    var release by remember { mutableStateOf<LocalRelease?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var pwaCache by remember { mutableStateOf<String?>(null) }
    var pwaReadFailed by remember { mutableStateOf(false) }
    fun refresh() {
        if (busy) return
        busy = true; error = ""
        scope.launch {
            try { release = updater.latest() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "无法读取 GitHub 发行信息。" }
            finally { busy = false }
        }
    }
    fun install(value: LocalRelease) {
        if (busy) return
        busy = true; error = ""
        scope.launch {
            try {
                val file = updater.download(context, value)
                onSnackbar(if (updater.openInstaller(context, file)) "APK 哈希、包名及签名校验通过，已打开系统安装器。" else "请允许安装未知应用，返回后再点击下载并安装。")
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "下载或安装失败。" }
            finally { busy = false }
        }
    }
    LaunchedEffect(Unit) { refresh() }
    LaunchedEffect(onlineRepository) {
        if (onlineRepository != null) {
            try { pwaCache = onlineRepository.latestUpdate().update?.pwaCacheVersion }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { pwaReadFailed = true }
        }
    }
    val latest = release
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SnowLetterSurface(modifier = Modifier.fillMaxWidth(), role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant, fallbackShape = RoundedCornerShape(22.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("版本与更新", style = MaterialTheme.typography.titleLarge)
                    WolfUpdateFact("本机版本", BuildConfig.VERSION_NAME)
                    WolfUpdateFact("versionCode", BuildConfig.VERSION_CODE.toString())
                    WolfUpdateFact("applicationId", BuildConfig.APPLICATION_ID)
                    if (onlineRepository != null) WolfUpdateFact("PWA cache", pwaCache ?: if (pwaReadFailed) "暂无法读取" else "—")
                    WolfUpdateFact("交付来源", "GitHub Releases · 本机直连")
                    latest?.let {
                        WolfUpdateFact("最新版本", it.version)
                        WolfUpdateFact("最新 versionCode", it.code.toString())
                        WolfUpdateFact("APK SHA-256", it.sha, mono = true)
                        WolfUpdateFact("Release", it.assets.tag)
                        Text(if (it.code > BuildConfig.VERSION_CODE) "发现新版本；下载后校验本机签名，再进入系统安装器。" else "当前已是最新版本。", style = MaterialTheme.typography.bodySmall)
                        if (it.assets.notes.isNotBlank()) Text(it.assets.notes, style = MaterialTheme.typography.bodySmall)
                    }
                    Text("更新不依赖海岸后端或模型额度；不会自动卸载旧应用。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = ::refresh, enabled = !busy) { Text("刷新") }
                        if (latest != null && latest.code > BuildConfig.VERSION_CODE) Button(onClick = { install(latest) }, enabled = !busy) { Text("下载并安装") }
                    }
                }
            }
        }
    }
}
