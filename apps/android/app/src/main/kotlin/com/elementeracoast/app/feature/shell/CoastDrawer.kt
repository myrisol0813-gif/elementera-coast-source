package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.R
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.model.ConversationSummary
import com.elementeracoast.app.core.model.FeatureDestination
import com.elementeracoast.app.core.model.RoomType
import com.elementeracoast.app.core.model.filterConversations
import com.elementeracoast.app.ui.theme.CoastChatTokens
import java.time.LocalDate
import java.time.temporal.ChronoUnit

@Composable
internal fun CoastDrawer(
    state: CoastShellState,
    onClose: () -> Unit,
    onOpenRoomType: (RoomType) -> Unit,
    onSelectConversation: (String) -> Unit,
    onRenameConversation: (String, String) -> Unit,
    onDeleteConversation: (String) -> Unit,
    onOpenFeature: (FeatureDestination) -> Unit,
    onCycleTheme: () -> Unit
) {
    var query by remember { mutableStateOf("") }

    ModalDrawerSheet(
        modifier = Modifier.width(CoastChatTokens.DrawerWidth),
        drawerContainerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = CoastChatTokens.DrawerOuterHorizontalPadding,
                        end = CoastChatTokens.DrawerOuterHorizontalPadding,
                        top = CoastChatTokens.DrawerHeaderTopPadding,
                        bottom = CoastChatTokens.DrawerHeaderBottomPadding
                    ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onClose) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "关闭侧边栏",
                        modifier = Modifier.size(CoastChatTokens.DrawerCloseGlyph)
                    )
                }
                Spacer(Modifier.width(5.dp))
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .background(
                            MaterialTheme.colorScheme.surfaceVariant,
                            RoundedCornerShape(CoastChatTokens.DrawerSearchRadius)
                        )
                        .padding(
                            horizontal = CoastChatTokens.DrawerSearchHorizontalPadding,
                            vertical = CoastChatTokens.DrawerSearchVerticalPadding
                        ),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Search,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(CoastChatTokens.DrawerSearchGlyph)
                    )
                    Spacer(Modifier.width(CoastChatTokens.DrawerSearchGap))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyMedium.copy(
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = CoastChatTokens.DrawerTextSize
                        ),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        decorationBox = { inner ->
                            if (query.isEmpty()) {
                                Text("搜索聊天", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            inner()
                        }
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(
                    horizontal = CoastChatTokens.DrawerOuterHorizontalPadding,
                    vertical = CoastChatTokens.DrawerContentVerticalPadding
                ),
                verticalArrangement = Arrangement.spacedBy(CoastChatTokens.DrawerItemGap)
            ) {
                item { CoastStatusStrip() }
                item { DrawerSectionLabel("聊天入口") }
                item {
                    DrawerEntry(
                        Icons.Default.Edit,
                        RoomType.Main.drawerLabel,
                        state.activeRoomType == RoomType.Main && state.activeFeature == null
                    ) { onOpenRoomType(RoomType.Main) }
                }
                item {
                    DrawerEntry(
                        Icons.Default.Radio,
                        RoomType.Radio.drawerLabel,
                        state.activeRoomType == RoomType.Radio && state.activeFeature == null && state.activeConversationId.isBlank()
                    ) { onOpenRoomType(RoomType.Radio) }
                }
                item {
                    DrawerEntry(
                        Icons.Default.MailOutline,
                        RoomType.Lighthouse.drawerLabel,
                        state.activeRoomType == RoomType.Lighthouse && state.activeFeature == null && state.activeConversationId.isBlank()
                    ) { onOpenRoomType(RoomType.Lighthouse) }
                }
                item {
                    DrawerEntry(
                        Icons.Default.Pets,
                        "记忆",
                        state.activeFeature == FeatureDestination.Memory
                    ) { onOpenFeature(FeatureDestination.Memory) }
                }
                item {
                    DrawerEntry(
                        Icons.Default.Today,
                        "小组件",
                        state.activeFeature == FeatureDestination.Daily
                    ) { onOpenFeature(FeatureDestination.Daily) }
                }
                item {
                    Spacer(Modifier.height(6.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                item { DrawerSectionLabel("聊天窗口") }
                item {
                    ConversationList(
                        conversations = state.conversations,
                        query = query,
                        activeConversationId = state.activeConversationId,
                        featureActive = state.activeFeature != null,
                        onSelectConversation = onSelectConversation,
                        onRenameConversation = onRenameConversation,
                        onDeleteConversation = onDeleteConversation
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(
                modifier = Modifier.padding(
                    horizontal = CoastChatTokens.DrawerOuterHorizontalPadding,
                    vertical = CoastChatTokens.DrawerBottomVerticalPadding
                )
            ) {
                DrawerEntry(
                    Icons.Default.Palette,
                    "主题",
                    false,
                    subtitle = state.theme.label,
                    onClick = onCycleTheme
                )
                DrawerUtilityEntry(
                    R.drawable.ic_coast_wolf,
                    "屋主设置",
                    "屋主设置入口",
                    state.activeFeature == FeatureDestination.Wolf
                ) { onOpenFeature(FeatureDestination.Wolf) }
                DrawerUtilityEntry(
                    R.drawable.ic_coast_serpent,
                    "模型工作台",
                    "模型工作台",
                    state.activeFeature == FeatureDestination.ActionLog
                ) { onOpenFeature(FeatureDestination.ActionLog) }
            }
        }
    }
}

@Composable
private fun DrawerSectionLabel(text: String) {
    Text(
        text = text,
        modifier = Modifier.padding(start = 10.dp, top = 8.dp, bottom = 2.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold
    )
}

@Composable
fun ConversationList(
    conversations: List<ConversationSummary>,
    query: String,
    activeConversationId: String,
    featureActive: Boolean,
    onSelectConversation: (String) -> Unit,
    onRenameConversation: (String, String) -> Unit,
    onDeleteConversation: (String) -> Unit
) {
    val filtered = filterConversations(conversations, query)
    val coast = filtered.filter { it.source != "rikkahub" }
    val rikka = filtered.filter { it.source == "rikkahub" }
    var rikkaExpanded by remember { mutableStateOf(false) }
    val showRikka = rikkaExpanded || query.isNotBlank()

    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (coast.isEmpty()) {
            Text(
                if (query.isBlank()) "还没有普通聊天窗口" else "没有匹配的普通窗口",
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 14.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        } else {
            coast.forEach { conversation ->
                ConversationRow(
                    conversation = conversation,
                    selected = conversation.id == activeConversationId && !featureActive,
                    onClick = { onSelectConversation(conversation.id) },
                    onRename = onRenameConversation,
                    onDelete = onDeleteConversation
                )
            }
        }

        Spacer(Modifier.height(5.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { rikkaExpanded = !rikkaExpanded }
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "RikkaHub",
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                if (showRikka) "⌃" else "⌄",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }

        if (showRikka) {
            if (rikka.isEmpty()) {
                Text(
                    "还没有导入 RikkaHub 窗口",
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                rikka.forEach { conversation ->
                    ConversationRow(
                        conversation = conversation,
                        selected = conversation.id == activeConversationId && !featureActive,
                        onClick = { onSelectConversation(conversation.id) },
                        onRename = onRenameConversation,
                        onDelete = onDeleteConversation
                    )
                }
            }
        }
    }
}

@Composable
private fun CoastStatusStrip() {
    val today = remember { LocalDate.now() }
    val orbit = remember(today) {
        (ChronoUnit.DAYS.between(LocalDate.of(2025, 8, 13), today) + 1).coerceAtLeast(1)
    }

    fun daysUntil(month: Int, day: Int): Long {
        var target = LocalDate.of(today.year, month, day)
        if (target.isBefore(today)) target = target.plusYears(1)
        return ChronoUnit.DAYS.between(today, target)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = CoastChatTokens.DrawerStatusBottomPadding),
        horizontalArrangement = Arrangement.spacedBy(CoastChatTokens.DrawerStatusGap)
    ) {
        StatusCard("共同度过 ", orbit.toString(), "日", Modifier.weight(1f))
        StatusCard("距纪念日", daysUntil(8, 12).toString(), "天", Modifier.weight(1f))
        StatusCard("距生日", daysUntil(8, 13).toString(), "天", Modifier.weight(1f))
    }
}

@Composable
private fun StatusCard(label: String, value: String, unit: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .heightIn(min = CoastChatTokens.DrawerStatusHeight)
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(CoastChatTokens.DrawerStatusRadius)
            )
            .padding(vertical = CoastChatTokens.DrawerStatusVerticalPadding),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium
        )
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            unit,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium
        )
    }
}

@Composable
private fun DrawerEntry(
    icon: ImageVector,
    title: String,
    selected: Boolean,
    subtitle: String? = null,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                RoundedCornerShape(CoastChatTokens.DrawerEntryRadius)
            )
            .clickable(onClick = onClick)
            .padding(
                horizontal = CoastChatTokens.DrawerEntryHorizontalPadding,
                vertical = if (subtitle == null) {
                    CoastChatTokens.DrawerEntryVerticalPadding
                } else {
                    CoastChatTokens.DrawerEntrySubtitleVerticalPadding
                }
            ),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(CoastChatTokens.DrawerEntryGlyph)
        )
        Spacer(Modifier.width(CoastChatTokens.DrawerEntryGap))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = CoastChatTokens.DrawerTextSize),
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = CoastChatTokens.DrawerSecondaryTextSize
                    )
                )
            }
        }
    }
}

@Composable
private fun DrawerUtilityEntry(
    iconRes: Int,
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                RoundedCornerShape(CoastChatTokens.DrawerEntryRadius)
            )
            .clickable(onClick = onClick)
            .padding(
                horizontal = CoastChatTokens.DrawerEntryHorizontalPadding,
                vertical = CoastChatTokens.DrawerEntrySubtitleVerticalPadding
            ),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(CoastChatTokens.DrawerUtilityIconBox),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                painter = painterResource(iconRes),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(CoastChatTokens.DrawerUtilityIcon)
            )
        }
        Spacer(Modifier.width(CoastChatTokens.DrawerUtilityGap))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = CoastChatTokens.DrawerUtilityTitleSize
                ),
                fontWeight = FontWeight.Medium
            )
            Text(
                subtitle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = CoastChatTokens.DrawerUtilitySubtitleSize
                )
            )
        }
    }
}

@Composable
private fun ConversationRow(
    conversation: ConversationSummary,
    selected: Boolean,
    onClick: () -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                RoundedCornerShape(CoastChatTokens.DrawerEntryRadius)
            ),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            conversation.title,
            modifier = Modifier
                .weight(1f)
                .clickable(onClick = onClick)
                .padding(
                    start = CoastChatTokens.DrawerEntryHorizontalPadding,
                    top = CoastChatTokens.ConversationVerticalPadding,
                    bottom = CoastChatTokens.ConversationVerticalPadding
                ),
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = CoastChatTokens.DrawerTextSize),
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        ConversationActionsButton(
            conversation = conversation,
            onRename = onRename,
            onDelete = onDelete
        )
    }
}
