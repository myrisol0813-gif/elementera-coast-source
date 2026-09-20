package com.elementeracoast.source

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                SourceHome()
            }
        }
    }
}

private data class SourceSection(
    val id: String,
    val title: String,
    val description: String,
)

private val sourceSections = listOf(
    SourceSection("chat", "聊天", "主聊天、共通聊天室与 MCP 对话区的 Native 页面骨架。"),
    SourceSection("memory", "记忆库", "记忆、待确认区、当前对话纸条与当前活跃线索的基础入口。"),
    SourceSection("workbench", "模型工作台", "本轮上下文预览、开发手与工具调用记录的基础入口。"),
    SourceSection("settings", "屋主设置", "主题、聊天参数、通用集成与快照导出的基础入口。"),
)

@Composable
private fun SourceHome() {
    var selectedId by remember { mutableStateOf(sourceSections.first().id) }
    val selected = sourceSections.first { it.id == selectedId }

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "Elementera Coast Source",
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = "Native source skeleton · 0.1.0-source",
                style = MaterialTheme.typography.bodyMedium,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                sourceSections.take(2).forEach { section ->
                    Button(
                        onClick = { selectedId = section.id },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(section.title)
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                sourceSections.drop(2).forEach { section ->
                    Button(
                        onClick = { selectedId = section.id },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(section.title)
                    }
                }
            }
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(selected.title, style = MaterialTheme.typography.titleLarge)
                    Text(selected.description, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "这里只保留公开 source 可继续实现的页面结构，不连接生产服务或私人视觉资产。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
