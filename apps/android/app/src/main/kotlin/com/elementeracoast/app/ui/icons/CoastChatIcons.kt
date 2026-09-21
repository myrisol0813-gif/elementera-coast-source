package com.elementeracoast.app.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

object CoastChatIcons {
    val Menu: ImageVector by lazy {
        ImageVector.Builder(name = "CoastMenu", defaultWidth = 24.dp, defaultHeight = 24.dp,
            viewportWidth = 24f, viewportHeight = 24f).apply {
            path(fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.7f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(5f, 8f); lineTo(19f, 8f)
                moveTo(5f, 12f); lineTo(16.5f, 12f)
                moveTo(5f, 16f); lineTo(18.5f, 16f)
            }
        }.build()
    }
}
