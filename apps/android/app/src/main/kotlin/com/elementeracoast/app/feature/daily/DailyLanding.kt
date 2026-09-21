package com.elementeracoast.app.feature.daily

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.feature.shell.FeaturePageTopBar
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.launch

internal data class DailyLandingItem(val title: String, val subtitle: String)
internal enum class DailyPage { Home, Moments, MomentCompose, Diary, DiaryCompose, Pet }

@Composable
fun DailyLanding(
    repository: DailyRepository,
    modelPartnerAvatarDataUrl: String,
    onUpdateModelPartnerAvatar: (String) -> Unit,
    onRefreshCoast: () -> Unit,
    onBackToChat: () -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit
) {
    var page by remember { mutableStateOf(DailyPage.Home) }
    val scope = rememberCoroutineScope()

    suspend fun refreshDaily() {
        try {
            repository.refresh()
            onRefreshCoast()
            onSnackbar("前端状态已刷新")
        } catch (error: CoastApiException) {
            onSnackbar("小组件刷新失败：${error.message}")
        }
    }

    LaunchedEffect(repository) {
        try {
            repository.refresh()
        } catch (error: CoastApiException) {
            onSnackbar("小组件载入失败：${error.message}")
        }
    }

    val refreshAction: () -> Unit = {
        scope.launch { refreshDaily() }
        Unit
    }

    Column(Modifier.fillMaxSize()) {
        when (page) {
            DailyPage.Home -> FeaturePageTopBar(
                title = "小组件",
                subtitle = "朋友圈与日记",
                onBack = onBackToChat,
                actionLabel = "刷新",
                onAction = refreshAction,
                compact = true
            )
            DailyPage.Moments -> FeaturePageTopBar(
                title = "碳硅圈",
                subtitle = "前端内部朋友圈",
                onBack = { page = DailyPage.Home },
                actionLabel = "+ 动态",
                onAction = { page = DailyPage.MomentCompose },
                secondaryActionLabel = "刷新",
                onSecondaryAction = refreshAction,
                compact = true
            )
            DailyPage.MomentCompose -> FeaturePageTopBar(
                "写碳硅圈",
                "直接写入前端正式条目",
                { page = DailyPage.Moments },
                compact = true
            )
            DailyPage.Diary -> FeaturePageTopBar(
                title = "日记",
                subtitle = "前端里的正式纸页",
                onBack = { page = DailyPage.Home },
                actionLabel = "+ 日记",
                onAction = { page = DailyPage.DiaryCompose },
                secondaryActionLabel = "刷新",
                onSecondaryAction = refreshAction,
                compact = true
            )
            DailyPage.DiaryCompose -> FeaturePageTopBar(
                "写日记",
                "直接写入前端正式日记",
                { page = DailyPage.Diary },
                compact = true
            )
            DailyPage.Pet -> FeaturePageTopBar(
                "宠物系统",
                "休憩箱尚未展开",
                { page = DailyPage.Home },
                compact = true
            )
        }

        Box(Modifier.weight(1f)) {
            when (page) {
                DailyPage.Home -> DailyHome(onOpen = { page = it }, onFutureWidgets = {
                    onSnackbar("未来小组件还没有长出来；这里只保留 PWA 母版入口。")
                })
                DailyPage.Moments -> MomentScreen(
                    repository = repository,
                    modelPartnerAvatarDataUrl = modelPartnerAvatarDataUrl,
                    onUpdateModelPartnerAvatar = onUpdateModelPartnerAvatar,
                    onActionLogged = onActionLogged,
                    onSnackbar = onSnackbar,
                    onCompose = { page = DailyPage.MomentCompose }
                )
                DailyPage.MomentCompose -> MomentComposeScreen(repository, onActionLogged, onSnackbar) { page = DailyPage.Moments }
                DailyPage.Diary -> DiaryScreen(repository, onActionLogged, onSnackbar) { page = DailyPage.DiaryCompose }
                DailyPage.DiaryCompose -> DiaryComposeScreen(repository, onActionLogged, onSnackbar) { page = DailyPage.Diary }
                DailyPage.Pet -> PetScreen()
            }
        }
    }
}

@Composable
private fun DailyHome(onOpen: (DailyPage) -> Unit, onFutureWidgets: () -> Unit) {
    val mapping = listOf(
        Triple(DailyPage.Moments, DailyLandingItem("碳硅圈", "前端内部朋友圈"), Icons.Default.FavoriteBorder),
        Triple(DailyPage.Diary, DailyLandingItem("日记", "留下今天的纸页"), Icons.Default.Edit),
        Triple(DailyPage.Pet, DailyLandingItem("宠物系统", "还在准备休憩箱"), Icons.Default.Pets)
    )
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 30.dp),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)
    ) {
        items(mapping) { (destination, item, icon) -> DailyHomeCard(item, icon) { onOpen(destination) } }
        item { DailyHomeCard(DailyLandingItem("未来小组件", "以后再慢慢长出来"), Icons.Default.Add, onFutureWidgets) }
    }
}

@Composable
private fun DailyHomeCard(item: DailyLandingItem, icon: ImageVector, onClick: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = shape
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 22.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.size(56.dp).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(15.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.size(16.dp))
            Column {
                Text(item.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(item.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** Active Daily destinations. Future widgets is a visual PWA-mother placeholder, not an active page. */
internal fun dailyLandingItems(): List<DailyLandingItem> = listOf(
    DailyLandingItem("碳硅圈", "前端内部朋友圈"),
    DailyLandingItem("日记", "留下今天的纸页"),
    DailyLandingItem("宠物系统", "还在准备休憩箱")
)
