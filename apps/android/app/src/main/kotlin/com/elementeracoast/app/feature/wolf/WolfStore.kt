package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.ui.theme.CoastThemePreset
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class WolfStore(private val persistence: LocalPersistence) {
    private val _state = MutableStateFlow(load())
    val state: StateFlow<WolfState> = _state.asStateFlow()

    fun saveProfile(nickname: String, signature: String) = update {
        it.copy(profile = WolfProfile(
            nickname = nickname.trim().ifBlank { "屋主" }.take(80),
            signature = signature.trim().ifBlank { nickname.trim().ifBlank { "屋主" } }.take(80)
        ))
    }

    fun setTheme(theme: CoastThemePreset) = update {
        it.copy(appearance = it.appearance.copy(theme = theme))
    }

    fun cycleTheme() {
        val current = _state.value.appearance.theme
        setTheme(CoastThemePreset.entries[(current.ordinal + 1) % CoastThemePreset.entries.size])
    }

    fun setUserBubble(hex: String) = update {
        it.copy(appearance = it.appearance.copy(userBubbleHex = sanitizeHex(hex)))
    }

    fun setAccent(hex: String) = update {
        it.copy(appearance = it.appearance.copy(accentHex = sanitizeHex(hex)))
    }

    fun updateBasic(transform: (BasicSettings) -> BasicSettings) = update {
        it.copy(basic = transform(it.basic).normalized())
    }

    private fun update(transform: (WolfState) -> WolfState) {
        val next = transform(_state.value)
        _state.value = next
        persist(next)
    }

    private fun load(): WolfState {
        fun int(key: String, fallback: Int) = persistence.get(key, fallback.toString()).toIntOrNull() ?: fallback
        fun bool(key: String, fallback: Boolean) = persistence.get(key, fallback.toString()).toBooleanStrictOrNull() ?: fallback
        val storedPreset = persistence.get(KEY_THEME_PRESET).ifBlank { persistence.get(KEY_LEGACY_THEME, CoastThemePreset.CoastDefault.name) }
        val theme = CoastThemePreset.fromStored(storedPreset)
        return WolfState(
            profile = WolfProfile(
                nickname = persistence.get(KEY_NICKNAME, "屋主").take(80),
                signature = persistence.get(KEY_SIGNATURE, "屋主").take(80)
            ),
            appearance = WolfAppearance(
                theme = theme,
                userBubbleHex = sanitizeHex(persistence.get(KEY_BUBBLE)),
                accentHex = sanitizeHex(persistence.get(KEY_ACCENT))
            ),
            basic = BasicSettings(
                recentTurns = int(KEY_RECENT_TURNS, 8),
                contextBudget = int(KEY_CONTEXT_BUDGET, 6000),
                outputLength = persistence.get(KEY_OUTPUT_LENGTH, "auto"),
                maxOutputTokens = int(KEY_MAX_OUTPUT, 8000),
                creativity = persistence.get(KEY_CREATIVITY, "balanced"),
                streamingEnabled = bool(KEY_STREAMING, true),
                soilBudget = int(KEY_SOIL_BUDGET, 1800),
                seedCooldownTurns = int(KEY_SEED_COOLDOWN, 2),
                worldbookEnabled = bool(KEY_WORLDBOOK_ENABLED, true),
                worldbookLimit = int(KEY_WORLDBOOK_LIMIT, 3),
                memoryLimit = int(KEY_MEMORY_LIMIT, 8)
            ).normalized()
        )
    }

    private fun persist(value: WolfState) {
        persistence.put(KEY_NICKNAME, value.profile.nickname)
        persistence.put(KEY_SIGNATURE, value.profile.signature)
        persistence.put(KEY_THEME_PRESET, value.appearance.theme.name)
        persistence.put(KEY_BUBBLE, value.appearance.userBubbleHex)
        persistence.put(KEY_ACCENT, value.appearance.accentHex)
        val basic = value.basic
        persistence.put(KEY_RECENT_TURNS, basic.recentTurns.toString())
        persistence.put(KEY_CONTEXT_BUDGET, basic.contextBudget.toString())
        persistence.put(KEY_OUTPUT_LENGTH, basic.outputLength)
        persistence.put(KEY_MAX_OUTPUT, basic.maxOutputTokens.toString())
        persistence.put(KEY_CREATIVITY, basic.creativity)
        persistence.put(KEY_STREAMING, basic.streamingEnabled.toString())
        persistence.put(KEY_SOIL_BUDGET, basic.soilBudget.toString())
        persistence.put(KEY_SEED_COOLDOWN, basic.seedCooldownTurns.toString())
        persistence.put(KEY_WORLDBOOK_ENABLED, basic.worldbookEnabled.toString())
        persistence.put(KEY_WORLDBOOK_LIMIT, basic.worldbookLimit.toString())
        persistence.put(KEY_MEMORY_LIMIT, basic.memoryLimit.toString())
    }

    private fun BasicSettings.normalized() = copy(
        recentTurns = recentTurns.coerceAtLeast(1),
        contextBudget = contextBudget.coerceAtLeast(1800),
        outputLength = outputLength.takeIf { it in setOf("auto", "short", "long") } ?: "auto",
        maxOutputTokens = maxOutputTokens.coerceIn(64, 65536),
        creativity = creativity.takeIf { it in setOf("stable", "balanced", "expansive") } ?: "balanced",
        soilBudget = soilBudget.coerceIn(300, 4000),
        seedCooldownTurns = seedCooldownTurns.coerceIn(0, 8),
        worldbookLimit = worldbookLimit.coerceIn(0, 6),
        memoryLimit = memoryLimit.coerceIn(0, 12)
    )

    private fun sanitizeHex(value: String): String {
        val clean = value.trim()
        return if (Regex("^#[0-9a-fA-F]{6}$").matches(clean)) clean.lowercase() else ""
    }

    companion object {
        private const val ROOT = "wolf."
        private const val KEY_NICKNAME = ROOT + "nickname"
        private const val KEY_SIGNATURE = ROOT + "signature"
        private const val KEY_THEME_PRESET = ROOT + "themePreset"
        private const val KEY_LEGACY_THEME = ROOT + "theme"
        private const val KEY_BUBBLE = ROOT + "bubble"
        private const val KEY_ACCENT = ROOT + "accent"
        private const val KEY_RECENT_TURNS = ROOT + "recentTurns"
        private const val KEY_CONTEXT_BUDGET = ROOT + "contextBudget"
        private const val KEY_OUTPUT_LENGTH = ROOT + "outputLength"
        private const val KEY_MAX_OUTPUT = ROOT + "maxOutputTokens"
        private const val KEY_CREATIVITY = ROOT + "creativity"
        private const val KEY_STREAMING = ROOT + "streamingEnabled"
        private const val KEY_SOIL_BUDGET = ROOT + "soilBudget"
        private const val KEY_SEED_COOLDOWN = ROOT + "seedCooldownTurns"
        private const val KEY_WORLDBOOK_ENABLED = ROOT + "worldbookEnabled"
        private const val KEY_WORLDBOOK_LIMIT = ROOT + "worldbookLimit"
        private const val KEY_MEMORY_LIMIT = ROOT + "memoryLimit"
    }
}
