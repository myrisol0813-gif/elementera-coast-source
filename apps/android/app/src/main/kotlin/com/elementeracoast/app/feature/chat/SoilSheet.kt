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
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.snowLetterSheetContainerColor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SoilBottomSheet(
    soil: ThoughtSoilSnapshot,
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
                    if (soil.manualLocked) "当前窗口 · 手动内容已锁定" else "当前窗口 · 滚动工作上下文",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            SoilCard(
                title = "当前整理当前对话的纸条",
                meta = if (soil.manualLocked) "已锁定" else "随当前窗口整理"
            ) {
                Text(
                    soil.currentText.ifBlank { "还没有整理当前方向。" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                if (soil.doNotRepeat.isNotBlank()) {
                    Spacer(Modifier.height(9.dp))
                    Text("勿复读", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        soil.doNotRepeat,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            SoilCard(
                title = "当前活跃线索",
                meta = "${soil.handSeeds.size.coerceAtMost(7)}/7"
            ) {
                if (soil.handSeeds.isEmpty()) {
                    SoilEmpty("还没有当前活跃线索。")
                } else {
                    soil.handSeeds.forEachIndexed { index, seed ->
                        if (index > 0) Spacer(Modifier.height(10.dp))
                        Text(
                            seed.name.ifBlank { seed.lifeCore },
                            fontWeight = FontWeight.Medium,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        if (seed.lifeCore.isNotBlank()) {
                            Text(seed.lifeCore, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        if (seed.usageHint.isNotBlank()) {
                            Text("使用 · ${seed.usageHint}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        if (seed.avoidHint.isNotBlank()) {
                            Text("避免 · ${seed.avoidHint}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            SoilCard(
                title = "待确认区",
                meta = "${soil.pocketCandidates.size} 条"
            ) {
                if (soil.pocketCandidates.isEmpty()) {
                    SoilEmpty("现在没有待确认候选。")
                } else {
                    soil.pocketCandidates.forEachIndexed { index, candidate ->
                        if (index > 0) Spacer(Modifier.height(10.dp))
                        Text(
                            candidate.title.ifBlank { candidate.lifeCore },
                            fontWeight = FontWeight.Medium,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        if (candidate.lifeCore.isNotBlank()) {
                            Text(candidate.lifeCore, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        if (candidate.sourceExcerpt.isNotBlank()) {
                            Text("来源 · ${candidate.sourceExcerpt}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "确认前只停在袋里，不参与长期召回。",
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
