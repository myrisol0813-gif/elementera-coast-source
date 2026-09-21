package com.elementeracoast.app.feature.shell

import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.feature.actionlog.ActionLogStore
import com.elementeracoast.app.feature.letters.IslandLetterStore
import com.elementeracoast.app.feature.wolf.WolfStore

/** Explicit local-only feature owners. Shared Coast data belongs to CoastBackendGraph repositories. */
class LocalFeatureServices(persistence: LocalPersistence) {
    val wolf = WolfStore(persistence)
    val actionLog = ActionLogStore(persistence)
    val islandLetter = IslandLetterStore(persistence)
}
