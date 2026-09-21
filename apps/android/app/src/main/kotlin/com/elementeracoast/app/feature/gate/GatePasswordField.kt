package com.elementeracoast.app.feature.gate

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.elementeracoast.app.ui.brand.CoastGold

@Composable
fun GatePasswordField(
    password: String,
    onPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    var focused by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val shape = RoundedCornerShape(GateVisualTokens.PasswordRadius)
    val shadowAmbient = if (focused) CoastGold.copy(alpha = .16f) else Color(0x1224252B)
    val shadowSpot = if (focused) CoastGold.copy(alpha = .12f) else Color(0x0B24252B)

    Row(
        modifier = modifier
            .widthIn(max = GateVisualTokens.PasswordWidth)
            .fillMaxWidth()
            .height(GateVisualTokens.PasswordHeight)
            .shadow(
                elevation = if (focused) 16.dp else 12.dp,
                shape = shape,
                clip = false,
                ambientColor = shadowAmbient,
                spotColor = shadowSpot
            )
            .clip(shape)
            .background(MaterialTheme.colorScheme.surface),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .height(GateVisualTokens.PasswordHeight)
                .padding(start = GateVisualTokens.PasswordStartPadding),
            contentAlignment = Alignment.CenterStart
        ) {
            if (password.isEmpty()) {
                Text(
                    text = "输入访问密码",
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .58f),
                    fontSize = GateVisualTokens.PasswordTextSize
                )
            }
            BasicTextField(
                value = password,
                onValueChange = onPasswordChange,
                enabled = enabled,
                modifier = Modifier
                    .fillMaxWidth()
                    .onFocusChanged { focused = it.isFocused },
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = GateVisualTokens.PasswordTextSize,
                    letterSpacing = .6.sp
                ),
                cursorBrush = SolidColor(CoastGold),
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(onDone = {
                    if (password.isNotBlank() && enabled) {
                        keyboard?.hide()
                        onSubmit()
                    }
                })
            )
        }

        Spacer(Modifier.width(4.dp))
        Box(
            modifier = Modifier
                .size(GateVisualTokens.PasswordActionSize)
                .clip(RoundedCornerShape(GateVisualTokens.PasswordActionRadius))
                .clickable(enabled = password.isNotBlank() && enabled, onClick = onSubmit),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = "进入",
                tint = if (password.isNotBlank() && enabled) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .36f),
                modifier = Modifier.size(19.dp)
            )
        }
        Spacer(Modifier.width(GateVisualTokens.PasswordEndPadding))
    }
}
