package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.local.MemoryLocalPersistence
import com.elementeracoast.app.ui.theme.CoastThemePreset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class WolfLocalParityTest {
    @Test fun wolfDenKeepsItsExistingEntrancesAndAddsVersionUpdate() {
        assertEquals(
            listOf("个人资料", "外观", "账户", "聊天记录", "模型箱", "基本设置", "关于与诊断", "版本与更新"),
            WolfDestination.entries.map { it.title }
        )
    }

    @Test fun basicSettingsExposeExactlyElevenActiveFieldsAndNoOldRunControl() {
        assertEquals(11, BasicSettings.activeFieldNames.size)
        assertEquals(
            listOf(
                "recentTurns", "contextBudget", "outputLength", "maxOutputTokens", "creativity",
                "streamingEnabled", "soilBudget", "seedCooldownTurns", "worldbookEnabled",
                "worldbookLimit", "memoryLimit"
            ), BasicSettings.activeFieldNames
        )
        val names = BasicSettings.activeFieldNames.joinToString(" ")
        listOf("autoRefreshEveryTurns", "maxHandSeeds", "conversationSeedLimit", "globalSeedLimit", "conversationMemoryLimit", "globalMemoryLimit").forEach {
            assertFalse(names.contains(it))
        }
    }

    @Test fun profileAppearanceAndSettingsPersistLocally() {
        val persistence = MemoryLocalPersistence()
        val store = WolfStore(persistence)
        store.saveProfile("Human Owner", "屋主")
        store.setTheme(CoastThemePreset.BlushModelPartner)
        store.setUserBubble("#f5e8ee")
        store.setAccent("#ec4899")
        store.updateBasic { it.copy(memoryLimit = 5, outputLength = "long") }
        val reloaded = WolfStore(persistence).state.value
        assertEquals("Human Owner", reloaded.profile.nickname)
        assertEquals(CoastThemePreset.BlushModelPartner, reloaded.appearance.theme)
        assertEquals("#f5e8ee", reloaded.appearance.userBubbleHex)
        assertEquals(5, reloaded.basic.memoryLimit)
        assertEquals("long", reloaded.basic.outputLength)
    }

    @Test fun legacyThreeModeThemeReadsIntoPresetWardrobeOnce() {
        val persistence = MemoryLocalPersistence()
        persistence.put("wolf.theme", "Gold")
        assertEquals(CoastThemePreset.DeepBlueGold, WolfStore(persistence).state.value.appearance.theme)
    }
}
