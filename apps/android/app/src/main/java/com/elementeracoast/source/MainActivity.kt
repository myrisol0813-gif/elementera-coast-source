package com.elementeracoast.source

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

@Composable
private fun SourceHome() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Elementera Coast Source",
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = "Native source skeleton · 0.1.0-source",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                text = "This shell is intentionally isolated from production services and private assets.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
