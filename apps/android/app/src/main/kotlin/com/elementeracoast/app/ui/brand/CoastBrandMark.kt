package com.elementeracoast.app.ui.brand

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import kotlin.math.max

@Composable
fun CoastBrandMark(
    modifier: Modifier = Modifier,
    separatorColor: Color = CoastPaper,
    loopAProgress: Float = 1f,
    loopBProgress: Float = 1f,
    loopCProgress: Float = 1f,
    hornProgress: Float = 1f,
    wolfProgress: Float = 1f,
    markScale: Float = 1f
) {
    Canvas(modifier = modifier.aspectRatio(390f / 300f)) {
        val sx = size.width / 390f
        val sy = size.height / 300f
        fun p(x: Float, y: Float) = Offset(x * sx, y * sy)
        val alpha = max(max(loopAProgress, loopBProgress), max(loopCProgress, max(hornProgress, wolfProgress))).coerceIn(0f, 1f)
        val stroke = Stroke(width = 7f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round)
        withTransform({ scale(markScale, markScale, p(195f, 150f)) }) {
            val house = Path().apply {
                moveTo(143f * sx, 112f * sy); lineTo(195f * sx, 70f * sy); lineTo(247f * sx, 112f * sy)
                moveTo(154f * sx, 106f * sy); lineTo(154f * sx, 165f * sy)
                moveTo(236f * sx, 106f * sy); lineTo(236f * sx, 165f * sy)
                moveTo(176f * sx, 165f * sy); lineTo(176f * sx, 129f * sy)
                quadraticTo(176f * sx, 113f * sy, 195f * sx, 113f * sy)
                quadraticTo(214f * sx, 113f * sy, 214f * sx, 129f * sy)
                lineTo(214f * sx, 165f * sy)
            }
            drawPath(house, CoastInk, alpha = alpha, style = stroke)
            val sea1 = Path().apply {
                moveTo(70f * sx, 215f * sy)
                quadraticTo(105f * sx, 198f * sy, 140f * sx, 215f * sy)
                quadraticTo(175f * sx, 232f * sy, 210f * sx, 215f * sy)
                quadraticTo(245f * sx, 198f * sy, 280f * sx, 215f * sy)
                quadraticTo(315f * sx, 232f * sy, 332f * sx, 215f * sy)
            }
            val sea2 = Path().apply {
                moveTo(90f * sx, 247f * sy)
                quadraticTo(122f * sx, 234f * sy, 154f * sx, 247f * sy)
                quadraticTo(186f * sx, 260f * sy, 218f * sx, 247f * sy)
                quadraticTo(250f * sx, 234f * sy, 282f * sx, 247f * sy)
                quadraticTo(306f * sx, 257f * sy, 322f * sx, 250f * sy)
            }
            drawPath(sea1, CoastInk, alpha = alpha, style = stroke)
            drawPath(sea2, CoastInk, alpha = alpha, style = stroke)
            val skyStroke = Stroke(width = 5f * sx, cap = StrokeCap.Round)
            drawLine(CoastMuted, p(120f, 26f), p(120f, 40f), 5f * sx, StrokeCap.Round, alpha)
            drawLine(CoastMuted, p(113f, 33f), p(127f, 33f), 5f * sx, StrokeCap.Round, alpha)
            drawLine(CoastMuted, p(270f, 12f), p(270f, 24f), 5f * sx, StrokeCap.Round, alpha)
            drawLine(CoastMuted, p(264f, 18f), p(276f, 18f), 5f * sx, StrokeCap.Round, alpha)
        }
    }
}

val CoastInk = Color(0xFF24252B)
val CoastGold = Color(0xFFF2B84B)
val CoastCream = Color(0xFFFFF0D8)
val CoastPaper = Color(0xFFFFFFFF)
val CoastMuted = Color(0xFF9C8872)
val CoastQuiet = Color(0xFFB8AFA6)
