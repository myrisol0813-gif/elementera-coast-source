package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.CoastChatTokens
import com.elementeracoast.app.ui.theme.coastSurfaceBackground
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import java.time.LocalDate

@Composable
internal fun CalendarAnniversaryStrip(repository: SideRoomsRepository, drawerOpen: Boolean, onSnackbar: (String) -> Unit) {
    var entries by remember(repository) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var error by remember { mutableStateOf("") }
    var revision by remember { mutableIntStateOf(0) }
    var today by remember { mutableStateOf(LocalDate.now()) }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var formOpen by remember { mutableStateOf(false) }
    LaunchedEffect(drawerOpen) {
        while (drawerOpen) { today = LocalDate.now(); delay(30_000) }
    }
    LaunchedEffect(repository, drawerOpen, revision, today) {
        if (!drawerOpen) return@LaunchedEffect
        try {
            entries = repository.pinnedCalendar(today.toString())["entries"]?.jsonArray.orEmpty().map { it.jsonObject }
            error = ""
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { entries = emptyList(); error = failure.message ?: "纪念日读取失败" }
    }
    BoxWithConstraints(Modifier.fillMaxWidth().padding(bottom = CoastChatTokens.DrawerStatusBottomPadding)) {
        val cardWidth = ((maxWidth - CoastChatTokens.DrawerStatusGap * 2) / 3).coerceAtLeast(64.dp)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(CoastChatTokens.DrawerStatusGap)) {
            entries.forEach { entry ->
                val status = entry["status"] as? JsonObject
                val phase = status?.calendarText("phase")
                val value = when (phase) { "today" -> "今天"; "no_future_occurrence" -> "无下次日期"; else -> status?.calendarText("days")?.ifBlank { "—" } ?: "—" }
                val unit = when (phase) { "elapsed" -> "日"; "upcoming" -> "天后"; "past" -> "天前"; else -> "" }
                AnniversaryCard(entry.calendarText("title"), value, unit, Modifier.width(cardWidth)) { editing = entry; formOpen = true }
            }
            AnniversaryCard("纪念日", "＋", "", Modifier.width(cardWidth)) { editing = null; formOpen = true }
            if (error.isNotBlank()) AnniversaryCard("读取失败", "重试", "", Modifier.width(cardWidth)) { revision++ }
        }
    }
    if (formOpen) CalendarEntryEditor(repository, editing, today, fromSidebar = true,
        onDismiss = { formOpen = false },
        onChanged = { formOpen = false; revision++ },
        onSnackbar = onSnackbar)
}

@Composable
private fun AnniversaryCard(label: String, value: String, unit: String, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.heightIn(min = CoastChatTokens.DrawerStatusHeight)
        .coastSurfaceBackground(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(CoastChatTokens.DrawerStatusRadius))
        .clickable(onClick = onClick)
        .padding(horizontal = 4.dp, vertical = CoastChatTokens.DrawerStatusVerticalPadding),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (unit.isNotBlank()) Text(unit, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
