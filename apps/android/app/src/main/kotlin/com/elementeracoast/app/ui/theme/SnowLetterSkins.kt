package com.elementeracoast.app.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.min

enum class SnowLetterSurfaceRole {
    AssistantBubble,
    UserBubble,
    ComposerField,
    ComposerButton,
    ActionButton,
    StatusCard,
    DogtalkCard,
    DogtalkField
}

@Composable
fun SnowLetterSurface(
    modifier: Modifier = Modifier,
    role: SnowLetterSurfaceRole,
    fallbackColor: Color,
    fallbackShape: Shape = RoundedCornerShape(18.dp),
    fallbackBorder: BorderStroke? = null,
    fallbackElevation: Dp = 0.dp,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable BoxScope.() -> Unit
) {
    val enabled = LocalCoastAppearance.current.preset.usesSnowLetterDecorations()
    val surfaceModifier = if (enabled) {
        Modifier.drawWithContent {
            drawSnowLetterTemplateSurface(role)
            drawContent()
        }
    } else {
        Modifier
            .optionalShadow(fallbackElevation, fallbackShape)
            .background(fallbackColor, fallbackShape)
            .then(if (fallbackBorder != null) Modifier.border(fallbackBorder, fallbackShape) else Modifier)
    }

    Box(
        modifier = modifier.then(surfaceModifier),
        contentAlignment = contentAlignment,
        content = content
    )
}

@Composable
fun snowLetterInnerPadding(role: SnowLetterSurfaceRole): PaddingValues =
    if (!LocalCoastAppearance.current.preset.usesSnowLetterDecorations()) {
        PaddingValues(0.dp)
    } else {
        when (role) {
            SnowLetterSurfaceRole.AssistantBubble -> PaddingValues(horizontal = 16.dp, vertical = 10.dp)
            SnowLetterSurfaceRole.UserBubble -> PaddingValues(horizontal = 2.dp, vertical = 1.dp)
            SnowLetterSurfaceRole.ComposerField -> PaddingValues(horizontal = 6.dp, vertical = 2.dp)
            SnowLetterSurfaceRole.ComposerButton -> PaddingValues(0.dp)
            SnowLetterSurfaceRole.ActionButton -> PaddingValues(0.dp)
            SnowLetterSurfaceRole.StatusCard -> PaddingValues(horizontal = 4.dp, vertical = 2.dp)
            SnowLetterSurfaceRole.DogtalkCard -> PaddingValues(horizontal = 4.dp, vertical = 2.dp)
            SnowLetterSurfaceRole.DogtalkField -> PaddingValues(horizontal = 4.dp, vertical = 2.dp)
        }
    }

@Composable
fun snowLetterSheetContainerColor(): Color =
    if (LocalCoastAppearance.current.preset.usesSnowLetterDecorations()) {
        Color(0xFFF2F7FB)
    } else {
        MaterialTheme.colorScheme.surfaceContainerLow
    }

@Composable
fun snowLetterComposerGlyphColor(fallback: Color): Color =
    if (LocalCoastAppearance.current.preset.usesSnowLetterDecorations()) {
        MaterialTheme.colorScheme.onSurface
    } else {
        fallback
    }

private fun Modifier.optionalShadow(elevation: Dp, shape: Shape): Modifier =
    if (elevation.value > 0f) shadow(elevation, shape, clip = false) else this

private fun DrawScope.drawSnowLetterTemplateSurface(role: SnowLetterSurfaceRole) {
    if (role == SnowLetterSurfaceRole.ActionButton || role == SnowLetterSurfaceRole.ComposerButton) {
        drawRoundStamp(role)
        return
    }

    if (size.width < 28.dp.toPx() || size.height < 24.dp.toPx()) {
        drawRoundStamp(role)
        return
    }

    // The torn paper already paints its own shadow. Keeping a second Compose
    // shadow behind the full measured box made very tall cards/messages look
    // detached from the paper and could swallow the lower action area.
    // Reserve enough trailing room for the torn-edge wobble instead.
    val trailingRoom = if (role.isSnowLetterStrip()) 2.dp.toPx() else 3.dp.toPx()
    val shadow = tornPath(
        2.dp.toPx(),
        2.dp.toPx(),
        size.width - trailingRoom,
        size.height - trailingRoom,
        role
    )
    drawPath(shadow, Color(0xFFB7C8D8).copy(alpha = snowLetterShadowAlpha(role)))

    val paper = tornPath(
        0f,
        0f,
        size.width - 5.dp.toPx(),
        size.height - 5.dp.toPx(),
        role
    )
    drawPath(paper, snowLetterPaperColor(role))
    drawPath(paper, snowLetterEdgeColor(role), style = Stroke(width = 1.dp.toPx()))

    drawCornerTape(role)
}

private fun SnowLetterSurfaceRole.isSnowLetterStrip(): Boolean =
    this == SnowLetterSurfaceRole.ComposerField ||
        this == SnowLetterSurfaceRole.StatusCard ||
        this == SnowLetterSurfaceRole.DogtalkCard ||
        this == SnowLetterSurfaceRole.DogtalkField

private fun DrawScope.tornPath(left: Float, top: Float, right: Float, bottom: Float, role: SnowLetterSurfaceRole): Path {
    val isStrip = role.isSnowLetterStrip()
    val step = if (isStrip) 18.dp.toPx() else 22.dp.toPx()
    val wobble = if (isStrip) 1.6.dp.toPx() else 2.4.dp.toPx()
    val safeLeft = left + 8.dp.toPx()
    val safeRight = right - 8.dp.toPx()
    val safeTop = top + 5.dp.toPx()
    val safeBottom = bottom - 5.dp.toPx()
    val path = Path()
    path.moveTo(safeLeft, top + wobble)
    var x = safeLeft
    var i = 0
    while (x < safeRight) {
        x = (x + step).coerceAtMost(safeRight)
        path.lineTo(x, top + ((i % 3) - 1) * wobble)
        i += 1
    }
    var y = safeTop
    while (y < safeBottom) {
        y = (y + step).coerceAtMost(safeBottom)
        path.lineTo(right + ((i % 3) - 1) * wobble, y)
        i += 1
    }
    x = safeRight
    while (x > safeLeft) {
        x = (x - step).coerceAtLeast(safeLeft)
        path.lineTo(x, bottom + ((i % 3) - 1) * wobble)
        i += 1
    }
    y = safeBottom
    while (y > safeTop) {
        y = (y - step).coerceAtLeast(safeTop)
        path.lineTo(left + ((i % 3) - 1) * wobble, y)
        i += 1
    }
    path.close()
    return path
}

private fun DrawScope.drawRoundStamp(role: SnowLetterSurfaceRole) {
    val radius = min(size.width, size.height) / 2f
    drawRoundRect(snowLetterPaperColor(role), size = size, cornerRadius = CornerRadius(radius, radius))
    drawRoundRect(
        color = snowLetterEdgeColor(role).copy(alpha = .72f),
        size = size,
        cornerRadius = CornerRadius(radius, radius),
        style = Stroke(width = 1.dp.toPx())
    )
}

private fun DrawScope.drawCornerTape(role: SnowLetterSurfaceRole) {
    if (role != SnowLetterSurfaceRole.AssistantBubble && role != SnowLetterSurfaceRole.StatusCard && role != SnowLetterSurfaceRole.DogtalkCard) return
    val tapeColor = Color(0xFFEBDDC9).copy(alpha = .26f)
    rotate(degrees = -8f, pivot = Offset(size.width - 24.dp.toPx(), 18.dp.toPx())) {
        drawRoundRect(
            color = tapeColor,
            topLeft = Offset(size.width - 52.dp.toPx(), 5.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(38.dp.toPx(), 13.dp.toPx()),
            cornerRadius = CornerRadius(3.dp.toPx(), 3.dp.toPx())
        )
    }
}

private fun snowLetterPaperColor(role: SnowLetterSurfaceRole): Color = when (role) {
    SnowLetterSurfaceRole.UserBubble -> Color(0xFFF7FBFF)
    SnowLetterSurfaceRole.ComposerField -> Color(0xFFFFFEFA)
    SnowLetterSurfaceRole.ComposerButton -> Color(0xFFFFFEFA)
    SnowLetterSurfaceRole.ActionButton -> Color(0xFFFFFEFA)
    SnowLetterSurfaceRole.StatusCard -> Color(0xFFF6FBFF)
    SnowLetterSurfaceRole.DogtalkCard -> Color(0xFFF6FBFF)
    SnowLetterSurfaceRole.DogtalkField -> Color(0xFFFFFEFA)
    else -> Color(0xFFFFFCF5)
}

private fun snowLetterEdgeColor(role: SnowLetterSurfaceRole): Color = when (role) {
    SnowLetterSurfaceRole.UserBubble -> Color(0xFFE3C690).copy(alpha = .42f)
    SnowLetterSurfaceRole.ComposerField, SnowLetterSurfaceRole.DogtalkField -> Color(0xFFD0DFEB).copy(alpha = .54f)
    SnowLetterSurfaceRole.StatusCard, SnowLetterSurfaceRole.DogtalkCard -> Color(0xFFD2E0EC).copy(alpha = .50f)
    else -> Color(0xFFC9D9E6).copy(alpha = .58f)
}

private fun snowLetterShadowAlpha(role: SnowLetterSurfaceRole): Float = when (role) {
    SnowLetterSurfaceRole.StatusCard, SnowLetterSurfaceRole.DogtalkCard -> .13f
    SnowLetterSurfaceRole.DogtalkField, SnowLetterSurfaceRole.ComposerField -> .12f
    SnowLetterSurfaceRole.ActionButton, SnowLetterSurfaceRole.ComposerButton -> .10f
    else -> .16f
}
