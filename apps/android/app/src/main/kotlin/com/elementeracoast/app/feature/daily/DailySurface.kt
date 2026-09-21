package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun DailySurfaceCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val shape = RoundedCornerShape(22.dp)
    val base = modifier
        .fillMaxWidth()
        .shadow(elevation = 2.dp, shape = shape, clip = false)
        .background(MaterialTheme.colorScheme.surfaceVariant, shape)
    Column(
        modifier = (if (onClick == null) base else base.clickable(onClick = onClick))
            .padding(horizontal = 20.dp, vertical = 20.dp)
    ) { content() }
}

@Composable
internal fun DailyPrimaryButton(label: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(elevation = 2.dp, shape = shape, clip = false)
            .background(MaterialTheme.colorScheme.primary, shape)
            .clickable(onClick = onClick)
            .padding(vertical = 15.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun DailyField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    minLines: Int = 1,
    maxLines: Int = 1
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = if (minLines > 3) 160.dp else 54.dp)
                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(18.dp))
                .padding(horizontal = 14.dp, vertical = 13.dp),
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            minLines = minLines,
            maxLines = maxLines,
            decorationBox = { inner ->
                if (value.isBlank() && placeholder.isNotBlank()) {
                    Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                }
                inner()
            }
        )
    }
}

@Composable
internal fun DailyIdentityBar(
    profileUri: String,
    modelPartnerUri: String,
    modelPartnerLabel: String,
    onProfileClick: () -> Unit,
    onModelPartnerAvatarClick: () -> Unit,
    onModelPartnerNameClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(18.dp))
            .padding(horizontal = 13.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        DailyIdentityChip("屋主", profileUri, "H", Modifier.weight(1f), onProfileClick, onProfileClick)
        DailyIdentityChip(
            modelPartnerLabel.ifBlank { "另一位屋主" },
            modelPartnerUri,
            "M",
            Modifier.weight(1f),
            onModelPartnerAvatarClick,
            onModelPartnerNameClick
        )
    }
}

@Composable
private fun DailyIdentityChip(
    label: String,
    uri: String,
    fallback: String,
    modifier: Modifier,
    onAvatarClick: () -> Unit,
    onLabelClick: () -> Unit
) {
    Row(
        modifier = modifier.clip(RoundedCornerShape(14.dp)).padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.clickable(onClick = onAvatarClick)) {
            DailyMiniAvatar(uri, fallback)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            label,
            modifier = Modifier.clickable(onClick = onLabelClick).padding(vertical = 4.dp),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold)
        )
    }
}

@Composable
private fun DailyMiniAvatar(uri: String, fallback: String) {
    val bitmap = rememberDailyBitmap(uri)
    Box(Modifier.size(28.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(fallback, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun DailyAvatar(uri: String, fallback: String) {
    val bitmap = rememberDailyBitmap(uri)
    Box(Modifier.size(54.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(fallback, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun DailyCover(uri: String, onClick: () -> Unit) {
    val bitmap = rememberDailyBitmap(uri)
    val shape = RoundedCornerShape(bottomStart = 22.dp, bottomEnd = 22.dp)
    if (bitmap != null) {
        Image(
            bitmap = bitmap,
            contentDescription = "碳硅圈封面",
            modifier = Modifier.fillMaxWidth().shadow(2.dp, shape, clip = false).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant).clickable(onClick = onClick),
            contentScale = ContentScale.FillWidth
        )
    } else {
        Box(
            modifier = Modifier.fillMaxWidth().height(180.dp).shadow(2.dp, shape, clip = false).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant).clickable(onClick = onClick),
            contentAlignment = Alignment.Center
        ) { Text("轻触设置封面", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun rememberDailyBitmap(source: String): ImageBitmap? {
    val context = LocalContext.current
    return produceState<ImageBitmap?>(initialValue = null, source) {
        value = if (source.isBlank()) null else DailyImageCodec.decodeForDisplay(context, source)
    }.value
}
