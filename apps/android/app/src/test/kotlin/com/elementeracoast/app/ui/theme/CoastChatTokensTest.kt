package com.elementeracoast.app.ui.theme

import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoastChatTokensTest {
    @Test
    fun roomScaleUsesCompactPwaLikeNativeChatTokens() {
        assertEquals(48.dp, CoastChatTokens.TopBarHeight)
        assertEquals(16.sp, CoastChatTokens.ChatBodySize)
        assertEquals(27.sp, CoastChatTokens.ChatBodyLineHeight)
        assertEquals(24.sp, CoastChatTokens.UserBodyLineHeight)
        assertEquals(4.dp, CoastChatTokens.ComposerVerticalPadding)
        assertEquals(44.dp, CoastChatTokens.ComposerPillMinHeight)
        assertEquals(48.dp, CoastChatTokens.ComposerTouchTarget)
        assertEquals(326.dp, CoastChatTokens.DrawerWidth)
        assertEquals(34.dp, CoastChatTokens.AssistantAvatarSize)
        assertEquals(20.dp, CoastChatTokens.UserBubbleRadius)
        assertTrue(CoastChatTokens.DogtalkExpandedMaxHeight <= 300.dp)
        assertEquals(30.dp, CoastChatTokens.DogtalkSaveVisualHeight)
        assertTrue(CoastChatTokens.DogtalkSaveTouchHeight >= CoastChatTokens.DogtalkSaveVisualHeight)
    }
}
