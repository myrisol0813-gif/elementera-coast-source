package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ThoughtCandidateSnapshot
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.snowLetterSheetContainerColor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SoilBottomSheet(
    soil: ThoughtSoilSnapshot,
    onSetEnabled: (Boolean) -> Unit,
    onOpenPendingBag: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = snowLetterSheetContainerColor()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Column(modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)) {
                Text("整理当前对话的纸条", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    when {
                        !soil.autoRefreshEnabled -> "当前窗口 · 已关闭，不整理也不递入上下文"
                        soil.manualLocked -> "当前窗口 · 手动内容已锁定 · 当前与余思仍会递入上下文"
                        else -> "当前 · 余思 · 去处"
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            SoilCard(
                title = if (soil.autoRefreshEnabled) "当前对话纸条已开启" else "当前对话纸条已关闭",
                meta = if (soil.autoRefreshEnabled) "自动整理 · 当前 / 余思注入上下文" else "停止整理 · 不注入上下文"
            ) {
                Text(
                    if (soil.autoRefreshEnabled) {
                        if (soil.manualLocked) {
                            "当前内容由屋主手动锁定，不会自动覆盖；只有“当前 / 余思”仍会递给模型。"
                        } else {
                            "每轮回复后自动整理。只有“当前 / 余思”进入下一轮；去处候选只进入待确认流程。"
                        }
                    } else {
                        "旧内容会原样保留；关闭期间不会继续整理，也不会递给模型。"
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                TextButton(onClick = { onSetEnabled(!soil.autoRefreshEnabled) }) {
                    Text(if (soil.autoRefreshEnabled) "关闭当前对话纸条" else "开启当前对话纸条")
                }
            }

            SoilCard(
                title = "当前",
                meta = if (soil.manualLocked) "已锁定" else "仍需承接"
            ) {
                Text(
                    soil.currentText.ifBlank { "现在没有需要越过最近上下文继续承接的内容。" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            SoilCard(
                title = "余思",
                meta = "${soil.afterthoughts.size} 条"
            ) {
                if (soil.afterthoughts.isEmpty()) {
                    SoilEmpty("这一刻没有想留下的余思。")
                } else {
                    soil.afterthoughts.forEachIndexed { index, item ->
                        if (index > 0) Spacer(Modifier.height(8.dp))
                        Text(
                            item,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }

            SoilCard(
                title = "去处",
                meta = "模型建议 · 仍需确认"
            ) {
                SoilCandidateGroup(
                    title = "记忆候选 · ${soil.memoryCandidates.size}",
                    emptyText = "没有想递往记忆库的内容。",
                    candidates = soil.memoryCandidates
                )
                Spacer(Modifier.height(12.dp))
                SoilCandidateGroup(
                    title = "种子候选 · ${soil.seedCandidates.size}",
                    emptyText = "没有想递往种子库的内容。",
                    candidates = soil.seedCandidates
                )
                if (soil.memoryCandidates.isNotEmpty() || soil.seedCandidates.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "这些只是模型建议的去处。候选会进入待确认区；确认前不会成为正式记忆或种子，也不会递进聊天正文。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                TextButton(
                    modifier = Modifier.padding(top = 2.dp),
                    onClick = {
                        onDismiss()
                        onOpenPendingBag()
                    }
                ) {
                    Text("打开待确认区")
                }
            }

            SoilCard(
                title = "来源 / 更新时间",
                meta = "revision ${soil.revision}"
            ) {
                Text(
                    "整理来源 · ${soil.organizer.ifBlank { "尚未整理" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                Text(
                    "更新时间 · ${soil.updatedAt.ifBlank { "暂无" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun SoilCandidateGroup(
    title: String,
    emptyText: String,
    candidates: List<ThoughtCandidateSnapshot>
) {
    Text(title, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
    if (candidates.isEmpty()) {
        Spacer(Modifier.height(4.dp))
        SoilEmpty(emptyText)
        return
    }
    candidates.forEachIndexed { index, candidate ->
        if (index > 0) Spacer(Modifier.height(10.dp)) else Spacer(Modifier.height(5.dp))
        Text(
            candidate.title.ifBlank { candidate.content },
            fontWeight = FontWeight.Medium,
            style = MaterialTheme.typography.bodyMedium
        )
        if (candidate.content.isNotBlank() && candidate.content != candidate.title) {
            Text(
                candidate.content,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
        if (candidate.sourceExcerpt.isNotBlank()) {
            Text(
                "来源 · ${candidate.sourceExcerpt}",
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .78f),
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}

@Composable
private fun SoilCard(
    title: String,
    meta: String = "",
    content: @Composable () -> Unit
) {
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth(),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .72f),
        fallbackShape = RoundedCornerShape(18.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 15.dp, vertical = 13.dp)
        ) {
            Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            if (meta.isNotBlank()) {
                Text(
                    meta,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .78f),
                    style = MaterialTheme.typography.labelSmall
                )
                Spacer(Modifier.height(7.dp))
            } else {
                Spacer(Modifier.height(5.dp))
            }
            content()
        }
    }
}

@Composable
private fun SoilEmpty(text: String) {
    Text(
        text,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall
    )
}
