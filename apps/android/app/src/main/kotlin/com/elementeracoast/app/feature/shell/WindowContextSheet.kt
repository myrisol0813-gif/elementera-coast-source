package com.elementeracoast.app.feature.shell

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.model.RealityContextFields
import com.elementeracoast.app.feature.chat.AndroidRealityContextSource

private data class RealityFieldUi(
    val key: String,
    val title: String,
    val note: String
)

private val REALITY_FIELDS = listOf(
    RealityFieldUi(RealityContextFields.DATE, "日期", "今天是哪一天"),
    RealityFieldUi(RealityContextFields.TIME, "时间", "当前本地时间与时区"),
    RealityFieldUi(RealityContextFields.BATTERY, "电量", "电量百分比与是否正在充电"),
    RealityFieldUi(RealityContextFields.WEATHER, "天气", "按下方手动城市读取当前天气"),
    RealityFieldUi(RealityContextFields.LOCATION, "位置", "可选 · 只给粗粒度城市 / 区域"),
    RealityFieldUi(RealityContextFields.RECENT_APP, "最近使用 App", "进入应用前最近一个其他 App"),
    RealityFieldUi(RealityContextFields.APP_USAGE, "今日 App 使用时间", "今天使用最多的前 5 个 App"),
    RealityFieldUi(RealityContextFields.CALENDAR, "日历", "未来 7 天所有重要日期"),
    RealityFieldUi(RealityContextFields.STEPS, "步数", "轻量系统计步；本日首次读取建立基线，无可靠数据时不递入")
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WindowContextSheet(
    conversationId: String,
    settings: ConversationContextSettings,
    thoughtSoilEnabled: Boolean,
    onSettingsChange: (ConversationContextSettings) -> Unit,
    onSetThoughtSoilEnabled: (Boolean) -> Unit,
    onOpenIslandLetter: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val usable = conversationId.isNotBlank()

    var usageAccess by remember { mutableStateOf(AndroidRealityContextSource.hasUsageAccess(context)) }
    var stepsAccess by remember { mutableStateOf(AndroidRealityContextSource.hasActivityRecognitionPermission(context)) }
    var locationAccess by remember { mutableStateOf(AndroidRealityContextSource.hasCoarseLocationPermission(context)) }
    var weatherCity by rememberSaveable(conversationId, settings.weatherCity) { mutableStateOf(settings.weatherCity) }

    fun refreshPermissions() {
        usageAccess = AndroidRealityContextSource.hasUsageAccess(context)
        stepsAccess = AndroidRealityContextSource.hasActivityRecognitionPermission(context)
        locationAccess = AndroidRealityContextSource.hasCoarseLocationPermission(context)
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshPermissions()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val wantsUsagePermission = settings.realityEnabled && (
        settings.has(RealityContextFields.RECENT_APP) || settings.has(RealityContextFields.APP_USAGE)
    )
    val wantsStepsPermission = settings.has(RealityContextFields.STEPS)
    val wantsLocationPermission = settings.has(RealityContextFields.LOCATION)

    val stepsPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        refreshPermissions()
    }
    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        refreshPermissions()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("这个窗口", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                if (usable) "只改变当前聊天窗口。屏幕显示的时间不等于模型自动知道时间。"
                else "先进入或新建一个聊天窗口，再设置这一窗的上下文。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )

            SoftSettingsCard {
                SettingSwitchRow(
                    title = "现实上下文",
                    note = if (settings.realityEnabled) "当前窗口按下方选择读取现场信息" else "关闭时不自动递入设备现场",
                    checked = settings.realityEnabled,
                    enabled = usable,
                    onCheckedChange = { onSettingsChange(settings.copy(realityEnabled = it)) }
                )

                if (settings.realityEnabled) {
                    REALITY_FIELDS.forEach { field ->
                        val checked = field.key in settings.realityFields
                        SettingSwitchRow(
                            title = field.title,
                            note = field.note,
                            checked = checked,
                            enabled = usable,
                            onCheckedChange = { enabled ->
                                val fields = if (enabled) (settings.realityFields + field.key).distinct()
                                else settings.realityFields - field.key
                                onSettingsChange(settings.copy(realityFields = fields))
                            }
                        )
                        if (field.key == RealityContextFields.WEATHER && checked) {
                            OutlinedTextField(
                                value = weatherCity,
                                onValueChange = { weatherCity = it.take(80) },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                shape = RoundedCornerShape(16.dp),
                                label = { Text("天气城市") },
                                supportingText = { Text("只按这里的城市取天气，不按 IP 猜位置。") }
                            )
                            Button(
                                onClick = { onSettingsChange(settings.copy(weatherCity = weatherCity.trim())) },
                                enabled = usable && weatherCity.trim() != settings.weatherCity,
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            ) { Text("保存天气城市") }
                        }
                    }
                }
            }

            SoftSettingsCard {
                SettingSwitchRow(
                    title = "短句模式",
                    note = "独立于现实上下文。普通闲聊优先简短接话，深话题仍可自然变长。",
                    checked = settings.shortReplyMode,
                    enabled = usable,
                    onCheckedChange = { onSettingsChange(settings.copy(shortReplyMode = it)) }
                )
                SettingSwitchRow(
                    title = "整理当前对话的纸条",
                    note = if (thoughtSoilEnabled) "每轮后整理，并递入下一轮上下文" else "旧内容保留；不再自动整理，也不递入",
                    checked = thoughtSoilEnabled,
                    enabled = usable,
                    onCheckedChange = onSetThoughtSoilEnabled
                )
            }

            if (wantsUsagePermission || wantsStepsPermission || wantsLocationPermission) {
                SoftSettingsCard {
                    Text("手机权限", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        "权限只决定相应字段本轮有没有数据。未授权不会阻止聊天。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                    if (wantsUsagePermission) {
                        PermissionRow(
                            title = "App 使用情况",
                            status = if (usageAccess) "已允许" else "未允许",
                            action = if (usageAccess) null else "去系统开启",
                            onAction = { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
                        )
                    }
                    if (wantsStepsPermission) {
                        PermissionRow(
                            title = "步数",
                            status = if (stepsAccess) "已允许" else "未允许",
                            action = if (stepsAccess || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) null else "允许",
                            onAction = {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                    stepsPermission.launch(Manifest.permission.ACTIVITY_RECOGNITION)
                                }
                            }
                        )
                    }
                    if (wantsLocationPermission) {
                        PermissionRow(
                            title = "粗略位置",
                            status = if (locationAccess) "已允许" else "未允许",
                            action = if (locationAccess) null else "允许",
                            onAction = { locationPermission.launch(Manifest.permission.ACCESS_COARSE_LOCATION) }
                        )
                    }
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onOpenIslandLetter,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(18.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                ) { Text("登岛信") }
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(18.dp)
                ) { Text("完成") }
            }
        }
    }
}

@Composable
private fun SoftSettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .52f),
        tonalElevation = 0.dp
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            content = content
        )
    }
}

@Composable
private fun SettingSwitchRow(
    title: String,
    note: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(note, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, enabled = enabled, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun PermissionRow(
    title: String,
    status: String,
    action: String?,
    onAction: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(status, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        action?.let {
            Spacer(Modifier.width(10.dp))
            Button(
                onClick = onAction,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                )
            ) { Text(it) }
        }
    }
}
