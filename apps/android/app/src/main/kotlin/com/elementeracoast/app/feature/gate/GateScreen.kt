package com.elementeracoast.app.feature.gate

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
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
    onOpenMailbox: () -> Unit
) {
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
                text = "Elementera Coast",
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

            Spacer(Modifier.height(passwordGap))
            Column(
                modifier = Modifier.graphicsLayer {
                    alpha = motion.form.coerceIn(0f, 1f)
                    translationY = formOffsetPx * (1f - motion.form.coerceIn(0f, 1f))
                },
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                GatePasswordField(
                    password = password,
                    onPasswordChange = onPasswordChange,
                    onSubmit = onEnter,
                    enabled = gateEnabled,
                    modifier = Modifier.width(GateVisualTokens.PasswordWidth)
                )

                if (authBusy || !authMessage.isNullOrBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = if (authBusy) "正在连接海岸…" else authMessage.orEmpty(),
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
