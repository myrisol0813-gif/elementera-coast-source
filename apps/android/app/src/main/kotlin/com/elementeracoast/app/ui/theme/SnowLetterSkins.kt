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

/** The existing shallow embossed paper remains Wave; Cut revives the old irregular Snow Letter treatment. */
internal fun SnowLetterSurfaceRole.usesEmbossedPaper(paperMode: CoastPaperMode): Boolean =
    paperMode == CoastPaperMode.Wave &&
        (this == SnowLetterSurfaceRole.AssistantBubble || this == SnowLetterSurfaceRole.UserBubble)

internal fun SnowLetterSurfaceRole.usesCutPaper(paperMode: CoastPaperMode): Boolean =
    paperMode == CoastPaperMode.Cut

/** Shared cloud paper; small icon buttons keep a round, easily tapped silhouette. */
internal fun SnowLetterSurfaceRole.usesCloudPaper(paperMode: CoastPaperMode): Boolean =
    paperMode == CoastPaperMode.Cloud &&
        this != SnowLetterSurfaceRole.ActionButton &&
        this != SnowLetterSurfaceRole.ComposerButton

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
    val appearance = LocalCoastAppearance.current
    val isMessageSurface = role == SnowLetterSurfaceRole.AssistantBubble || role == SnowLetterSurfaceRole.UserBubble
    val messageAlpha = appearance.messageSurfaceAlpha.coerceIn(.55f, 1f)
    val cloud = role.usesCloudPaper(appearance.paperMode)
    val embossed = role.usesEmbossedPaper(appearance.paperMode)
    val cut = role.usesCutPaper(appearance.paperMode)

    val messageFill = when (role) {
        SnowLetterSurfaceRole.UserBubble -> appearance.userBubbleColor ?: MaterialTheme.colorScheme.surface
        SnowLetterSurfaceRole.AssistantBubble -> MaterialTheme.colorScheme.surface
        else -> fallbackColor
    }
    val paperFill = if (isMessageSurface) {
        messageFill.copy(alpha = messageFill.alpha * messageAlpha)
    } else {
        fallbackColor
    }

    val surfaceModifier = when {
        cloud -> {
            val shape = CoastCloudShape
            val cloudFill = if (role == SnowLetterSurfaceRole.UserBubble && appearance.userBubbleColor == null) {
                fallbackColor.copy(alpha = fallbackColor.alpha * messageAlpha)
            } else {
                paperFill
            }
            val shadowTint = MaterialTheme.colorScheme.onSurface
            Modifier
                .shadow(
                    elevation = 2.dp,
                    shape = shape,
                    clip = false,
                    ambientColor = shadowTint.copy(alpha = .20f * messageAlpha),
                    spotColor = shadowTint.copy(alpha = .16f * messageAlpha)
                )
                .background(cloudFill, shape)
                .then(
                    if (appearance.cloudOutlineEnabled) {
                        Modifier.border(
                            0.75.dp,
                            MaterialTheme.colorScheme.outlineVariant.copy(alpha = .70f * messageAlpha),
                            shape
                        )
                    } else {
                        Modifier
                    }
                )
        }
        embossed -> {
            val paperShape = if (role == SnowLetterSurfaceRole.UserBubble) fallbackShape else RoundedCornerShape(17.dp)
            val shadowTint = Color(0xFF8495A6)
            Modifier
                .shadow(
                    elevation = 2.dp,
                    shape = paperShape,
                    clip = false,
                    ambientColor = shadowTint.copy(alpha = .10f * messageAlpha),
                    spotColor = shadowTint.copy(alpha = .07f * messageAlpha)
                )
                .background(paperFill, paperShape)
                .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .23f * messageAlpha), paperShape)
        }
        cut -> {
            val edgeColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .54f)
            val shadowColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = cutPaperShadowAlpha(role))
            val tapeColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = .32f)
            Modifier.drawWithContent {
                drawCutPaperSurface(
                    role = role,
                    paperColor = paperFill,
                    edgeColor = edgeColor,
                    shadowColor = shadowColor,
                    tapeColor = tapeColor
                )
                drawContent()
            }
        }
        else -> {
            val color = if (isMessageSurface) fallbackColor.copy(alpha = fallbackColor.alpha * messageAlpha) else fallbackColor
            Modifier
                .optionalShadow(fallbackElevation, fallbackShape)
                .background(color, fallbackShape)
                .then(if (fallbackBorder != null) Modifier.border(fallbackBorder, fallbackShape) else Modifier)
        }
    }

    Box(
        modifier = modifier.then(surfaceModifier),
        contentAlignment = contentAlignment,
        content = content
    )
}

@Composable
fun snowLetterInnerPadding(role: SnowLetterSurfaceRole): PaddingValues =
    if (role == SnowLetterSurfaceRole.AssistantBubble) {
        PaddingValues(horizontal = 13.dp, vertical = 10.dp)
    } else {
        PaddingValues(0.dp)
    }

@Composable
fun snowLetterSheetContainerColor(): Color = MaterialTheme.colorScheme.background

@Composable
fun snowLetterComposerGlyphColor(fallback: Color): Color = fallback

private fun Modifier.optionalShadow(elevation: Dp, shape: Shape): Modifier =
    if (elevation.value > 0f) shadow(elevation, shape, clip = false) else this

private fun DrawScope.drawCutPaperSurface(
    role: SnowLetterSurfaceRole,
    paperColor: Color,
    edgeColor: Color,
    shadowColor: Color,
    tapeColor: Color
) {
    if (role == SnowLetterSurfaceRole.ActionButton || role == SnowLetterSurfaceRole.ComposerButton) {
        drawRoundStamp(paperColor, edgeColor)
        return
    }

    if (size.width < 28.dp.toPx() || size.height < 24.dp.toPx()) {
        drawRoundStamp(paperColor, edgeColor)
        return
    }

    val trailingRoom = if (role.isCutPaperStrip()) 2.dp.toPx() else 3.dp.toPx()
    val shadow = tornPath(
        2.dp.toPx(),
        2.dp.toPx(),
        size.width - trailingRoom,
        size.height - trailingRoom,
        role
    )
    drawPath(shadow, shadowColor)

    val paper = tornPath(
        0f,
        0f,
        size.width - 5.dp.toPx(),
        size.height - 5.dp.toPx(),
        role
    )
    drawPath(paper, paperColor)
    drawPath(paper, edgeColor, style = Stroke(width = 1.dp.toPx()))

    drawCornerTape(role, tapeColor)
}

private fun SnowLetterSurfaceRole.isCutPaperStrip(): Boolean =
    this == SnowLetterSurfaceRole.ComposerField ||
        this == SnowLetterSurfaceRole.StatusCard ||
        this == SnowLetterSurfaceRole.DogtalkCard ||
        this == SnowLetterSurfaceRole.DogtalkField

private fun DrawScope.tornPath(left: Float, top: Float, right: Float, bottom: Float, role: SnowLetterSurfaceRole): Path {
    val isStrip = role.isCutPaperStrip()
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

private fun DrawScope.drawRoundStamp(paperColor: Color, edgeColor: Color) {
    val radius = min(size.width, size.height) / 2f
    drawRoundRect(paperColor, size = size, cornerRadius = CornerRadius(radius, radius))
    drawRoundRect(
        color = edgeColor.copy(alpha = edgeColor.alpha * .72f),
        size = size,
        cornerRadius = CornerRadius(radius, radius),
        style = Stroke(width = 1.dp.toPx())
    )
}

private fun DrawScope.drawCornerTape(role: SnowLetterSurfaceRole, tapeColor: Color) {
    if (role != SnowLetterSurfaceRole.AssistantBubble &&
        role != SnowLetterSurfaceRole.StatusCard &&
        role != SnowLetterSurfaceRole.DogtalkCard
    ) return
    rotate(degrees = -8f, pivot = Offset(size.width - 24.dp.toPx(), 18.dp.toPx())) {
        drawRoundRect(
            color = tapeColor,
            topLeft = Offset(size.width - 52.dp.toPx(), 5.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(38.dp.toPx(), 13.dp.toPx()),
            cornerRadius = CornerRadius(3.dp.toPx(), 3.dp.toPx())
        )
    }
}

private fun cutPaperShadowAlpha(role: SnowLetterSurfaceRole): Float = when (role) {
    SnowLetterSurfaceRole.StatusCard, SnowLetterSurfaceRole.DogtalkCard -> .10f
    SnowLetterSurfaceRole.DogtalkField, SnowLetterSurfaceRole.ComposerField -> .09f
    SnowLetterSurfaceRole.ActionButton, SnowLetterSurfaceRole.ComposerButton -> .07f
    else -> .12f
}
