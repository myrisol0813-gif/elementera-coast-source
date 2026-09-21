package com.elementeracoast.app.feature.dogtalk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.ui.theme.CoastChatTokens
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.coastDogtalkCardColor
import com.elementeracoast.app.ui.theme.coastDogtalkFieldColor
import kotlinx.coroutines.launch

private const val DefaultDogtalkBody = "屋主这轮很放松，因此偷懒中。"
private const val KeepPrivateNotice = "本条不会发送给模型，只留在人类思考链小抽屉里。"

@Composable
fun DogtalkCard(
    scope: DogtalkScope,
    conversationId: String,
    repository: DogtalkRepository,
    crossWindowRepository: CrossWindowRepository,
    crossWindow: CrossWindowUiState,
    onCrossWindowChange: (CrossWindowUiState) -> Unit,
    historyLoading: Boolean,
    isStreaming: Boolean,
    onNotice: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val canUse = scope != DogtalkScope.Main || conversationId.isNotBlank()
    var open by rememberSaveable(scope, conversationId) { mutableStateOf(false) }
    var pane by rememberSaveable(scope, conversationId) { mutableStateOf("dogtalk") }
    var draft by remember(scope, conversationId) { mutableStateOf(repository.cached(scope, conversationId)) }
    var readModeMenuOpen by remember(scope, conversationId) { mutableStateOf(false) }
    var saving by remember(scope, conversationId) { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()
    val shape = RoundedCornerShape(CoastChatTokens.DogtalkRadius)
    val cardColor = coastDogtalkCardColor()
    val fieldColor = coastDogtalkFieldColor()

    LaunchedEffect(scope, conversationId, historyLoading, isStreaming) {
        if (canUse && !historyLoading && !isStreaming) {
            runCatching { repository.refresh(scope, conversationId) }
                .onSuccess { draft = it }
        }
    }

    SnowLetterSurface(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = CoastChatTokens.DogtalkOuterVerticalPadding),
        role = SnowLetterSurfaceRole.DogtalkCard,
        fallbackColor = cardColor,
        fallbackShape = shape
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { open = !open }
                    .padding(
                        horizontal = CoastChatTokens.DogtalkCollapsedHorizontalPadding,
                        vertical = CoastChatTokens.DogtalkCollapsedVerticalPadding
                    ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "屋主 · 人类思考链 / 跨窗口",
                        style = MaterialTheme.typography.labelMedium.copy(fontSize = CoastChatTokens.DogtalkTitleSize),
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = draft.body.ifBlank { DefaultDogtalkBody },
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .82f),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = CoastChatTokens.DogtalkMetaSize),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.width(7.dp))
                Icon(
                    imageVector = Icons.Default.ExpandMore,
                    contentDescription = if (open) "收起人类思考链 / 跨窗口" else "展开人类思考链 / 跨窗口",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f),
                    modifier = Modifier.size(16.dp)
                )
            }

            if (open) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = CoastChatTokens.DogtalkExpandedMaxHeight)
                        .verticalScroll(rememberScrollState())
                        .padding(
                            start = CoastChatTokens.DogtalkExpandedHorizontalPadding,
                            end = CoastChatTokens.DogtalkExpandedHorizontalPadding,
                            bottom = CoastChatTokens.DogtalkExpandedBottomPadding
                        )
                ) {
                    DogtalkTabs(
                        selected = pane,
                        fieldColor = fieldColor,
                        onSelect = { pane = it }
                    )
                    Spacer(Modifier.height(9.dp))
                    if (pane == "cross" || pane == "keyword") {
                        CrossWindowPane(
                            conversationId = conversationId,
                            repository = crossWindowRepository,
                            state = crossWindow,
                            onChange = onCrossWindowChange,
                            onNotice = onNotice,
                            keywordOnly = pane == "keyword"
                        )
                    } else {
                        Text(
                            text = "不写也可以。人类思考链是助力，不是打卡。",
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = .88f),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.DogtalkBodySize)
                        )
                        Spacer(Modifier.height(3.dp))
                        Text(
                            text = if (canUse) {
                                "它只是此刻的低权重天气，不是指令或偏好；不进入整理当前对话的纸条、落袋、种子、记忆或自动总结。"
                            } else {
                                "发出这一窗的第一条消息后，就可以把人类思考链保存进同一片海岸。"
                            },
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = CoastChatTokens.DogtalkMetaSize)
                        )
                        Spacer(Modifier.height(8.dp))

                        DogtalkField("人类思考链本体", draft.body, { draft = draft.copy(body = it) }, fieldColor = fieldColor)
                        Spacer(Modifier.height(7.dp))
                        DogtalkField("真心核", draft.trueCore, { draft = draft.copy(trueCore = it) }, fieldColor = fieldColor)
                        Spacer(Modifier.height(7.dp))
                        DogtalkField(
                            label = "当前天气",
                            value = draft.weather,
                            onValueChange = { draft = draft.copy(weather = it) },
                            singleLine = true,
                            fieldColor = fieldColor
                        )
                        Spacer(Modifier.height(7.dp))

                        Text(
                            text = "另一位屋主是否需要看",
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .78f),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = CoastChatTokens.DogtalkMetaSize),
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(Modifier.height(4.dp))
                        Box {
                            SnowLetterSurface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { readModeMenuOpen = true },
                                role = SnowLetterSurfaceRole.DogtalkField,
                                fallbackColor = fieldColor,
                                fallbackShape = RoundedCornerShape(CoastChatTokens.DogtalkFieldRadius)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(
                                            horizontal = CoastChatTokens.DogtalkFieldHorizontalPadding,
                                            vertical = CoastChatTokens.DogtalkFieldVerticalPadding
                                        ),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = draft.readMode.label,
                                        modifier = Modifier.weight(1f),
                                        color = MaterialTheme.colorScheme.onSurface,
                                        style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.DogtalkBodySize)
                                    )
                                    Icon(
                                        imageVector = Icons.Default.ExpandMore,
                                        contentDescription = "选择 另一位屋主是否需要看",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .7f),
                                        modifier = Modifier.size(15.dp)
                                    )
                                }
                            }
                            DropdownMenu(
                                expanded = readModeMenuOpen,
                                onDismissRequest = { readModeMenuOpen = false },
                                modifier = Modifier
                                    .widthIn(
                                        min = CoastChatTokens.DogtalkMenuWidthMin,
                                        max = CoastChatTokens.DogtalkMenuWidthMax
                                    )
                                    .background(fieldColor, RoundedCornerShape(CoastChatTokens.DogtalkFieldRadius))
                            ) {
                                DogtalkReadMode.entries.forEach { mode ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                mode.label,
                                                style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.DogtalkBodySize)
                                            )
                                        },
                                        onClick = {
                                            draft = draft.copy(readMode = mode)
                                            readModeMenuOpen = false
                                        }
                                    )
                                }
                            }
                        }

                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = if (draft.readMode == DogtalkReadMode.KeepPrivate) KeepPrivateNotice else draft.readMode.futureSemantics,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .7f),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = CoastChatTokens.DogtalkMetaSize)
                        )

                        CompactDogtalkSaveButton(enabled = canUse && !saving) {
                            saving = true
                            coroutineScope.launch {
                                try {
                                    draft = repository.save(scope, conversationId, draft)
                                    onNotice("人类思考链已写回海岸")
                                } catch (error: CoastApiException) {
                                    onNotice(error.message)
                                } finally {
                                    saving = false
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DogtalkTabs(selected: String, fieldColor: androidx.compose.ui.graphics.Color, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(fieldColor, RoundedCornerShape(13.dp))
            .padding(4.dp)
    ) {
        listOf("dogtalk" to "人类思考链", "cross" to "跨窗口取信", "keyword" to "旧信关键词").forEach { (key, label) ->
            val active = selected == key
            Box(
                modifier = Modifier
                    .weight(1f)
                    .background(
                        if (active) MaterialTheme.colorScheme.surface else androidx.compose.ui.graphics.Color.Transparent,
                        RoundedCornerShape(10.dp)
                    )
                    .clickable { onSelect(key) }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = label,
                    color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium.copy(fontSize = CoastChatTokens.DogtalkBodySize),
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun CompactDogtalkSaveButton(enabled: Boolean, onClick: () -> Unit) {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .width(CoastChatTokens.DogtalkSaveTouchWidth)
                .height(CoastChatTokens.DogtalkSaveTouchHeight)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .widthIn(min = CoastChatTokens.DogtalkSaveVisualMinWidth)
                    .height(CoastChatTokens.DogtalkSaveVisualHeight)
                    .background(
                        MaterialTheme.colorScheme.primary.copy(alpha = if (enabled) 1f else .45f),
                        RoundedCornerShape(CoastChatTokens.DogtalkSaveRadius)
                    )
                    .padding(horizontal = CoastChatTokens.DogtalkSaveHorizontalPadding),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "保存",
                    color = MaterialTheme.colorScheme.onPrimary,
                    fontSize = CoastChatTokens.DogtalkSaveTextSize,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun DogtalkField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    singleLine: Boolean = false,
    fieldColor: androidx.compose.ui.graphics.Color
) {
    Text(
        text = label,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .78f),
        style = MaterialTheme.typography.labelSmall.copy(fontSize = CoastChatTokens.DogtalkMetaSize),
        fontWeight = FontWeight.Medium
    )
    Spacer(Modifier.height(4.dp))
    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(
                min = if (singleLine) CoastChatTokens.DogtalkSingleLineHeight else CoastChatTokens.DogtalkTextMinHeight,
                max = if (singleLine) CoastChatTokens.DogtalkSingleLineHeight else CoastChatTokens.DogtalkTextMaxHeight
            ),
        role = SnowLetterSurfaceRole.DogtalkField,
        fallbackColor = fieldColor,
        fallbackShape = RoundedCornerShape(CoastChatTokens.DogtalkFieldRadius)
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = CoastChatTokens.DogtalkFieldHorizontalPadding,
                    vertical = CoastChatTokens.DogtalkFieldVerticalPadding
                ),
            textStyle = MaterialTheme.typography.bodySmall.copy(
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = CoastChatTokens.DogtalkBodySize
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            singleLine = singleLine,
            maxLines = if (singleLine) 1 else 3,
            decorationBox = { inner ->
                Box(modifier = Modifier.fillMaxWidth()) {
                    if (value.isBlank()) {
                        Text(
                            text = "可留空",
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.DogtalkBodySize)
                        )
                    }
                    inner()
                }
            }
        )
    }
}
