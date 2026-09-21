package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal const val ModelPartnerCommentActionLabel = "模型伙伴留言"

@Composable
internal fun MomentActionRows(
    moment: DailyMoment,
    footer: String,
    modelPartnerCommentBusy: Boolean,
    onLike: () -> Unit,
    onComment: () -> Unit,
    onModelPartnerComment: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            footer,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Normal)
        )
        IconButton(onClick = onLike, modifier = Modifier.size(34.dp)) {
            Icon(
                imageVector = if (moment.liked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                contentDescription = if (moment.liked) "取消点赞" else "点赞",
                tint = if (moment.liked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp)
            )
        }
        IconButton(onClick = onComment, modifier = Modifier.size(34.dp)) {
            Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = "评论", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
        MomentActionChip(if (modelPartnerCommentBusy) "留言中…" else ModelPartnerCommentActionLabel, enabled = !modelPartnerCommentBusy, onClick = onModelPartnerComment)
    }

    Spacer(Modifier.size(3.dp))
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        MomentTextAction("编辑", onEdit)
        Spacer(Modifier.size(5.dp))
        MomentTextAction("删除", onDelete)
    }
}

@Composable
private fun MomentActionChip(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal)
    )
}

@Composable
private fun MomentTextAction(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 5.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal)
    )
}
