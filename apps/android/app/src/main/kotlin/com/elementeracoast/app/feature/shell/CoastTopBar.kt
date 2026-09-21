package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.R
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.RoomType
import com.elementeracoast.app.core.model.modelDisplayName
import com.elementeracoast.app.ui.icons.CoastChatIcons
import com.elementeracoast.app.ui.theme.CoastChatTokens

@Composable
internal fun CoastTopBar(
    state: CoastShellState,
    onOpenDrawer: () -> Unit,
    onBack: () -> Unit,
    onOpenModels: () -> Unit,
    onRefresh: () -> Unit,
    onNewConversation: () -> Unit,
    onMore: () -> Unit
) {
    Column(modifier = Modifier.background(MaterialTheme.colorScheme.background)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(CoastChatTokens.TopBarHeight)
                .padding(horizontal = CoastChatTokens.TopBarHorizontalPadding),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (state.activeFeature != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                Spacer(Modifier.width(6.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        state.activeFeature.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        state.activeFeature.subtitle,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            } else {
                IconButton(onClick = onOpenDrawer) {
                    Icon(
                        CoastChatIcons.Menu,
                        contentDescription = "打开侧边栏",
                        modifier = Modifier.size(CoastChatTokens.TopBarMenuGlyph)
                    )
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(onClick = onOpenModels)
                        .padding(
                            horizontal = CoastChatTokens.TopBarModelHorizontalPadding,
                            vertical = CoastChatTokens.TopBarModelVerticalPadding
                        )
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "ChatGPT",
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontSize = CoastChatTokens.TopBarTitleSize
                            ),
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(Modifier.width(CoastChatTokens.TopBarModelGap))
                        Text(
                            modelDisplayName(state.currentModel),
                            modifier = Modifier.widthIn(max = CoastChatTokens.TopBarModelMaxWidth),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = CoastChatTokens.TopBarModelSize
                            ),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    if (state.activeRoomType != RoomType.Main) {
                        Text(
                            text = state.activeRoomType.drawerLabel,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = .82f),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = CoastChatTokens.TopBarRoomSize
                            ),
                            maxLines = 1
                        )
                    }
                }
                IconButton(onClick = onRefresh) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "刷新前端状态",
                        modifier = Modifier.size(CoastChatTokens.TopBarActionGlyph)
                    )
                }
                IconButton(onClick = onNewConversation) {
                    Icon(
                        painter = painterResource(R.drawable.ic_coast_new_chat),
                        contentDescription = "新建当前类型窗口",
                        modifier = Modifier.size(CoastChatTokens.TopBarActionGlyph)
                    )
                }
                IconButton(onClick = onMore) {
                    Icon(
                        Icons.Default.MoreHoriz,
                        contentDescription = "更多",
                        modifier = Modifier.size(CoastChatTokens.TopBarActionGlyph)
                    )
                }
            }
        }
        HorizontalDivider(
            thickness = CoastChatTokens.TopBarDividerThickness,
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = CoastChatTokens.TopBarDividerAlpha)
        )
    }
}
