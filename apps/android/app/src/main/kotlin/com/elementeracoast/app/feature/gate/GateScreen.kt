package com.elementeracoast.app.feature.gate

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.core.tour.SourceVisitGate
import com.elementeracoast.app.ui.brand.CoastBrandMarkAnimation
import com.elementeracoast.app.ui.brand.CoastMuted
import com.elementeracoast.app.ui.brand.rememberCoastGateMotion

@Composable
fun GateScreen(
    password: String,
    authBusy: Boolean,
    authMessage: String?,
    onPasswordChange: (String) -> Unit,
    onEnter: () -> Unit,
    onOpenMailbox: () -> Unit,
    onEnterLocal: (() -> Unit)? = null
) {
    var localSelected by rememberSaveable { mutableStateOf(false) }
    var confirmLocal by rememberSaveable { mutableStateOf(false) }
    val motion = rememberCoastGateMotion()
    val density = LocalDensity.current

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = GateVisualTokens.ScreenHorizontalPadding)
    ) {
        val compact = maxHeight < GateVisualTokens.CompactHeightThreshold
        val markWidth = if (compact) GateVisualTokens.CompactBrandMarkWidth else GateVisualTokens.BrandMarkWidth
        val passwordGap = if (compact) GateVisualTokens.CompactTaglineToPassword else GateVisualTokens.TaglineToPassword
        val textOffsetPx = with(density) { 6.dp.toPx() }
        val formOffsetPx = with(density) { 10.dp.toPx() }
        val gateEnabled = motion.form >= .98f && !authBusy

        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .offset(y = GateVisualTokens.ContentVerticalShift)
                .widthIn(max = GateVisualTokens.ContentMaxWidth)
                .fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CoastBrandMarkAnimation(
                motion = motion,
                modifier = Modifier.width(markWidth),
                separatorColor = MaterialTheme.colorScheme.background
            )

            Spacer(Modifier.height(GateVisualTokens.MarkToTitle))
            Text(
                text = "一个开源前端",
                modifier = Modifier.graphicsLayer {
                    alpha = motion.brand.coerceIn(0f, 1f)
                    translationY = textOffsetPx * (1f - motion.brand.coerceIn(0f, 1f))
                },
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = GateVisualTokens.TitleSize,
                fontWeight = FontWeight(650),
                letterSpacing = GateVisualTokens.TitleLetterSpacing,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(GateVisualTokens.TitleToTagline))
            Text(
                text = "进入你的长期对话空间",
                modifier = Modifier.graphicsLayer {
                    alpha = motion.tagline.coerceIn(0f, 1f)
                    translationY = textOffsetPx * (1f - motion.tagline.coerceIn(0f, 1f))
                },
                color = CoastMuted,
                fontSize = GateVisualTokens.TaglineSize,
                fontWeight = FontWeight(450),
                letterSpacing = GateVisualTokens.TaglineLetterSpacing,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(if (onEnterLocal == null) passwordGap else 16.dp))
            if (onEnterLocal != null) {
                Row(
                    modifier = Modifier.graphicsLayer { alpha = motion.form.coerceIn(0f, 1f) },
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    GateModeBubble("本机模式", localSelected, gateEnabled) { localSelected = true }
                    GateModeBubble("前后端模式", !localSelected, gateEnabled) { localSelected = false }
                }
                Spacer(Modifier.height(18.dp))
            }
            Column(
                modifier = Modifier.graphicsLayer {
                    alpha = motion.form.coerceIn(0f, 1f)
                    translationY = formOffsetPx * (1f - motion.form.coerceIn(0f, 1f))
                },
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (localSelected && onEnterLocal != null) {
                    Text(
                        text = "进入本机空间  →",
                        modifier = Modifier.width(GateVisualTokens.PasswordWidth)
                            .clip(RoundedCornerShape(22.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .65f))
                            .clickable(enabled = gateEnabled) { confirmLocal = true }
                            .padding(vertical = 18.dp),
                        color = MaterialTheme.colorScheme.onBackground,
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyLarge
                    )
                    Spacer(Modifier.height(10.dp))
                    Text("无需密码 · 数据保存在本机", color = CoastMuted, style = MaterialTheme.typography.bodySmall)
                } else {
                GatePasswordField(
                    password = password,
                    onPasswordChange = onPasswordChange,
                    onSubmit = onEnter,
                    enabled = gateEnabled,
                    modifier = Modifier.width(GateVisualTokens.PasswordWidth)
                )

                if (SourceVisitGate.enabled) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "参观口令：123456 · 可以看原有页面，不连接云端",
                        modifier = Modifier.width(GateVisualTokens.PasswordWidth),
                        color = CoastMuted,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center
                    )
                } else if (BuildConfig.SOURCE_PREVIEW_PASSWORD_HINT.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "source debug 默认预览密码：${BuildConfig.SOURCE_PREVIEW_PASSWORD_HINT} · 部署时请修改",
                        modifier = Modifier.width(GateVisualTokens.PasswordWidth),
                        color = CoastMuted,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center
                    )
                }

                if (authBusy || !authMessage.isNullOrBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = if (authBusy) "正在连接…" else authMessage.orEmpty(),
                        modifier = Modifier.width(GateVisualTokens.PasswordWidth),
                        color = if (authBusy) CoastMuted else MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(GateVisualTokens.PasswordToMailbox))
                GateSmallEntry("访客信箱", gateEnabled, onOpenMailbox)
                }
            }
        }

    }
    if (confirmLocal && onEnterLocal != null) AlertDialog(
        onDismissRequest = { confirmLocal = false },
        title = { Text("关于本机模式") },
        text = { Text("卸载 APP 或清除应用数据会删除本机资料，不会自动同步到服务器。请定期前往屋主设置 → 聊天记录 → 防丢导出保存副本。当前导出不是完整可恢复备份，请勿据此卸载。") },
        confirmButton = { TextButton(onClick = { confirmLocal = false; onEnterLocal() }) { Text("确认进入") } },
        dismissButton = { TextButton(onClick = { confirmLocal = false }) { Text("返回") } }
    )
}

@Composable
private fun GateSmallEntry(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 7.dp),
        color = CoastMuted.copy(alpha = if (enabled) 1f else .45f),
        fontSize = GateVisualTokens.MailboxEntrySize,
        letterSpacing = GateVisualTokens.MailboxEntryLetterSpacing
    )
}

@Composable
private fun GateModeBubble(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Text(
        text = label,
        modifier = Modifier.clip(RoundedCornerShape(999.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .17f)
                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .48f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 19.dp, vertical = 9.dp),
        color = (if (selected) MaterialTheme.colorScheme.primary else CoastMuted)
            .copy(alpha = if (enabled) 1f else .6f),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
    )
}
