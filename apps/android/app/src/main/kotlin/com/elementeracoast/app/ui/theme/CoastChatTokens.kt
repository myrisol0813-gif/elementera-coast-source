package com.elementeracoast.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object CoastChatTokens {
    val TopBarHeight = 48.dp
    val TopBarHorizontalPadding = 4.dp
    val TopBarTitleSize = 18.sp
    val TopBarModelSize = 15.sp
    val TopBarModelMaxWidth = 158.dp
    val TopBarRoomSize = 11.sp
    val TopBarMenuGlyph = 22.dp
    val TopBarActionGlyph = 20.dp
    val TopBarModelGap = 6.dp
    val TopBarModelHorizontalPadding = 0.dp
    val TopBarModelVerticalPadding = 2.dp
    val TopBarDividerThickness = 0.5.dp
    const val TopBarDividerAlpha = 0.62f

    val TimelineMaxWidth = 760.dp
    val TimelineHorizontalPadding = 24.dp
    val TimelineTopPadding = 28.dp
    val TimelineBottomPadding = 20.dp
    val MessageGap = 28.dp
    val ChatBodySize = 16.sp
    val ChatBodyLineHeight = 27.sp
    val UserBodyLineHeight = 24.sp
    const val UserBubbleWidth = .86f
    val UserBubbleRadius = 20.dp
    val UserBubbleHorizontalPadding = 15.dp
    val UserBubbleVerticalPadding = 10.dp
    val UserActionTopGap = 7.dp
    val VariantActionGap = 3.dp
    val AssistantAvatarSize = 34.dp
    val AssistantAvatarGap = 14.dp
    val AssistantStarSize = 13.sp
    val MessageActionTopGap = 10.dp
    val StreamingGap = 5.dp

    val MetadataTopGap = 8.dp
    val MetadataRadius = 14.dp
    val MetadataHorizontalPadding = 12.dp
    val MetadataVerticalPadding = 10.dp
    val MetadataSectionGap = 9.dp
    val MetadataRowGap = 4.dp
    val MetadataTitleSize = 12.sp
    val MetadataBodySize = 12.sp
    val MetadataRawMaxHeight = 280.dp
    val MetadataDeskHorizontalPadding = 16.dp
    val MetadataDeskVerticalPadding = 8.dp

    val DogtalkHorizontalPadding = 0.dp
    val DogtalkOuterVerticalPadding = 4.dp
    val DogtalkRadius = 16.dp
    val DogtalkCollapsedHorizontalPadding = 13.dp
    val DogtalkCollapsedVerticalPadding = 8.dp
    val DogtalkExpandedHorizontalPadding = 13.dp
    val DogtalkExpandedBottomPadding = 9.dp
    val DogtalkExpandedMaxHeight = 292.dp
    val DogtalkFieldRadius = 11.dp
    val DogtalkSingleLineHeight = 36.dp
    val DogtalkTextMinHeight = 48.dp
    val DogtalkTextMaxHeight = 68.dp
    val DogtalkFieldHorizontalPadding = 10.dp
    val DogtalkFieldVerticalPadding = 7.dp
    val DogtalkTitleSize = 12.sp
    val DogtalkMetaSize = 11.sp
    val DogtalkBodySize = 13.sp
    val DogtalkMenuWidthMin = 236.dp
    val DogtalkMenuWidthMax = 318.dp
    val DogtalkSaveTouchWidth = 88.dp
    val DogtalkSaveTouchHeight = 44.dp
    val DogtalkSaveVisualMinWidth = 68.dp
    val DogtalkSaveVisualHeight = 30.dp
    val DogtalkSaveRadius = 15.dp
    val DogtalkSaveHorizontalPadding = 14.dp
    val DogtalkSaveTextSize = 12.sp

    val ComposerHorizontalPadding = 12.dp
    val ComposerVerticalPadding = 4.dp
    val ComposerTouchTarget = 48.dp
    val ComposerVisualButton = 42.dp
    val ComposerActionGlyph = 20.dp
    val ComposerPlusGlyph = 22.dp
    val ComposerPillMinHeight = 44.dp
    val ComposerPillMaxHeight = 132.dp
    val ComposerPillRadius = 25.dp
    val ComposerPillStartPadding = 16.dp
    val ComposerPillEndPadding = 6.dp
    val ComposerPillVerticalPadding = 7.dp
    val ComposerTextSize = 16.sp
    val ComposerTextLineHeight = 22.sp
    val ComposerMicTouch = 32.dp
    val ComposerMicGlyph = 19.dp
    val ComposerGap = 7.dp

    val DrawerWidth = 326.dp
    val DrawerOuterHorizontalPadding = 14.dp
    val DrawerContentVerticalPadding = 11.dp
    val DrawerHeaderTopPadding = 7.dp
    val DrawerHeaderBottomPadding = 7.dp
    val DrawerCloseGlyph = 22.dp
    val DrawerSearchRadius = 13.dp
    val DrawerSearchHorizontalPadding = 11.dp
    val DrawerSearchVerticalPadding = 8.dp
    val DrawerSearchGlyph = 17.dp
    val DrawerSearchGap = 8.dp
    val DrawerTextSize = 15.sp
    val DrawerSecondaryTextSize = 12.sp
    val DrawerItemGap = 3.dp
    val DrawerEntryRadius = 12.dp
    val DrawerEntryHorizontalPadding = 11.dp
    val DrawerEntryVerticalPadding = 9.dp
    val DrawerEntrySubtitleVerticalPadding = 8.dp
    val DrawerEntryGlyph = 19.dp
    val DrawerEntryGap = 10.dp
    val DrawerStatusHeight = 68.dp
    val DrawerStatusGap = 7.dp
    val DrawerStatusBottomPadding = 13.dp
    val DrawerStatusRadius = 13.dp
    val DrawerStatusVerticalPadding = 8.dp
    val DrawerBottomVerticalPadding = 8.dp
    val DrawerUtilityIconBox = 38.dp
    val DrawerUtilityIcon = 25.dp
    val DrawerUtilityTitleSize = 16.sp
    val DrawerUtilitySubtitleSize = 12.sp
    val DrawerUtilityGap = 11.dp
    val ConversationVerticalPadding = 10.dp
    val ConversationMoreGlyph = 19.dp
}

@Composable
fun coastDogtalkCardColor(): Color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .72f)

@Composable
fun coastDogtalkFieldColor(): Color = MaterialTheme.colorScheme.surface.copy(alpha = .94f)
