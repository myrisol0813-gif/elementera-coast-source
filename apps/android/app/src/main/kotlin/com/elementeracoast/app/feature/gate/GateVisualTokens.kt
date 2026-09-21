package com.elementeracoast.app.feature.gate

import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Gate-only visual constants. Values are anchored to the current PWA gate in
 * elementera-coast/functions/auth.js instead of being scattered through UI code.
 */
object GateVisualTokens {
    val ScreenHorizontalPadding = 22.dp
    val ContentMaxWidth = 390.dp
    val ContentVerticalShift = 18.dp
    val CompactHeightThreshold = 690.dp

    // Native keeps the PWA composition but scales the lockup down slightly for
    // Android density so the mark reads as a quiet splash, not a launcher icon.
    val BrandMarkWidth = 252.dp
    val CompactBrandMarkWidth = 220.dp
    val MarkToTitle = 26.dp
    val TitleToTagline = 6.dp
    val TaglineToPassword = 46.dp
    val CompactTaglineToPassword = 30.dp
    val PasswordToMailbox = 15.dp

    val TitleSize = 25.sp
    val TitleLetterSpacing = 0.8.sp
    val TaglineSize = 14.sp
    val TaglineLetterSpacing = 2.4.sp
    val MailboxEntrySize = 12.sp
    val MailboxEntryLetterSpacing = 0.96.sp

    val PasswordWidth = 306.dp
    val PasswordHeight = 52.dp
    val PasswordRadius = 18.dp
    val PasswordStartPadding = 20.dp
    val PasswordEndPadding = 8.dp
    val PasswordActionSize = 38.dp
    val PasswordActionRadius = 13.dp
    val PasswordTextSize = 15.sp

    val MailboxWebTopPadding = 12.dp
    val MailboxWebErrorGap = 6.dp

}
