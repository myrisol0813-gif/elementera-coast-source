package com.elementeracoast.app.feature.gate

import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.feature.shell.SourcePreviewDemo
import com.elementeracoast.app.ui.brand.CoastGateMotionSpec
import org.junit.Assert.assertEquals
import org.junit.Test

class GateContractTest {
    @Test
    fun pwaMotionTimingIsPreserved() {
        assertEquals(50, CoastGateMotionSpec.LoopAStartMs)
        assertEquals(160, CoastGateMotionSpec.LoopBStartMs)
        assertEquals(270, CoastGateMotionSpec.LoopCStartMs)
        assertEquals(720, CoastGateMotionSpec.LoopDurationMs)
        assertEquals(620, CoastGateMotionSpec.HornStartMs)
        assertEquals(760, CoastGateMotionSpec.WolfStartMs)
        assertEquals(980, CoastGateMotionSpec.SettleStartMs)
        assertEquals(1020, CoastGateMotionSpec.BrandStartMs)
        assertEquals(1140, CoastGateMotionSpec.TaglineStartMs)
        assertEquals(1380, CoastGateMotionSpec.GateFormStartMs)
        assertEquals(1780, CoastGateMotionSpec.TotalDurationMs)
    }

    @Test
    fun sourceBuildPublishesPreviewPasswordHint() {
        assertEquals("https://elementera-coast-source.invalid", BuildConfig.COAST_API_BASE_URL)
        assertEquals("123456", BuildConfig.SOURCE_PREVIEW_PASSWORD_HINT)
    }

    @Test
    fun sourcePreviewDemoShowsOneCompleteLocalTurn() {
        assertEquals(1, SourcePreviewDemo.messages.count { it.role.name == "User" })
        assertEquals(1, SourcePreviewDemo.messages.count { it.role.name == "Assistant" })
        val user = SourcePreviewDemo.messages.first()
        val assistant = SourcePreviewDemo.messages.last()
        assertEquals(2, user.attachments.size)
        assertEquals(setOf("image", "file"), user.attachments.map { it.type }.toSet())
        assertEquals(2, assistant.furnitureRuns.size)
        assertEquals("source/demo-model", assistant.modelId)
        assertEquals(1, SourcePreviewDemo.thoughtSoil.handSeeds.size)
        assertEquals("本轮递给模型 · source preview", assistant.deskReceipt?.summary)
    }

    @Test
    fun mailboxVisitorSessionIsSeparateFromOwnerSession() {
        val store = MemoryMailboxSessionStore()
        store.save("__Host-coast_mailbox=test-token")
        assertEquals("__Host-coast_mailbox=test-token", store.load())
        store.clear()
        assertEquals(null, store.load())
        assertEquals("__Host-coast_mailbox", AndroidMailboxSessionStore.COOKIE_NAME)
    }
}
