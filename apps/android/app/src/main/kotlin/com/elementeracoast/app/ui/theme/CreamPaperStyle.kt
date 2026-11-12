package com.elementeracoast.app.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/** Flat paper, cocoa outlines and an unblurred, offset shadow. No image assets. */
internal object CreamPaperStyle {
    val Background = Color(0xFFFFF7EC)
    val Surface = Color(0xFFFFFDF6)
    val Pink = Color(0xFFF0C9C1)
    val Ink = Color(0xFF2A1D1B)
    val Muted = Color(0xFF70544C)
    val Outline = Color(0xFF4F2E29)
    val Shadow = Color(0xFFBD927F)
    val Gold = Color(0xFFE4BA68)
    val BorderWidth = 2.dp
    val ShadowDepth = 4.dp
    val CardShape = RoundedCornerShape(24.dp)
    val Shapes = Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = RoundedCornerShape(14.dp),
        medium = RoundedCornerShape(20.dp),
        large = CardShape,
        extraLarge = RoundedCornerShape(30.dp)
    )
}

/** Keep custom bubble colors and opacity; other controls retain semantic/disabled colors. */
internal fun creamPaperFill(
    role: SnowLetterSurfaceRole,
    appearance: CoastAppearance,
    fallback: Color
): Color {
    val fill = when (role) {
        SnowLetterSurfaceRole.AssistantBubble -> appearance.palette.surface
        SnowLetterSurfaceRole.UserBubble -> appearance.userBubbleColor ?: appearance.palette.card
        else -> return fallback
    }
    return fill.copy(alpha = fill.alpha * appearance.messageSurfaceAlpha.coerceIn(.55f, 1f))
}

/** Reserve the shadow in layout so lazy lists and sheet edges cannot crop it.
 * Cut the card silhouette out of the shadow, keeping translucent message paper translucent.
 * Pressing moves only the drawing; the 48dp composer touch target never changes.
 */
internal fun Modifier.creamPaperFrame(
    color: Color,
    shape: Shape = CreamPaperStyle.CardShape,
    depth: Dp = CreamPaperStyle.ShadowDepth,
    pressed: Boolean = false
): Modifier {
    val travel = if (pressed) depth / 2 else 0.dp
    return this
        .padding(end = depth, bottom = depth)
        .offset(x = travel, y = travel)
        .drawWithCache {
            val outline = shape.createOutline(size, layoutDirection, this)
            val silhouette = Path().apply {
                when (outline) {
                    is Outline.Rectangle -> addRect(outline.rect)
                    is Outline.Rounded -> addRoundRect(outline.roundRect)
                    is Outline.Generic -> addPath(outline.path)
                }
            }
            val displacement = (depth - travel).toPx()
            val horizontal = if (layoutDirection == LayoutDirection.Rtl) -displacement else displacement
            onDrawBehind {
                clipPath(silhouette, clipOp = ClipOp.Difference) {
                    translate(left = horizontal, top = displacement) {
                        drawOutline(outline, CreamPaperStyle.Shadow.copy(alpha = color.alpha))
                    }
                }
            }
        }
        .background(color, shape)
        .border(CreamPaperStyle.BorderWidth, CreamPaperStyle.Outline.copy(alpha = color.alpha), shape)
}

/** Shared shell/settings surfaces retain their existing appearance outside this preset. */
@Composable
internal fun Modifier.coastSurfaceBackground(color: Color, shape: Shape): Modifier =
    if (LocalCoastAppearance.current.preset == CoastThemePreset.CreamPaper) {
        creamPaperFrame(color, shape)
    } else {
        background(color, shape)
    }

@Composable
internal fun Modifier.coastPaperHeader(): Modifier =
    if (LocalCoastAppearance.current.preset == CoastThemePreset.CreamPaper) {
        padding(horizontal = 12.dp, vertical = 6.dp)
            .creamPaperFrame(CreamPaperStyle.Surface)
            .padding(horizontal = 2.dp, vertical = 4.dp)
    } else {
        this
    }
