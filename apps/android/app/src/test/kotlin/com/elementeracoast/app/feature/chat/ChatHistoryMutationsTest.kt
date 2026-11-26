package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.remote.RemoteAssistantBranches
import com.elementeracoast.app.core.remote.RemoteHistory
import com.elementeracoast.app.core.remote.RemoteTurn
import com.elementeracoast.app.core.remote.RemoteUserBranch
import com.elementeracoast.app.core.remote.RemoteVariant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatHistoryMutationsTest {
    private fun branchedHistory(): RemoteHistory = RemoteHistory(
        conversationId = "conversation-1",
        turns = listOf(
            RemoteTurn(
                id = "turn-1",
                user = RemoteUserBranch(
                    active = 0,
                    variants = listOf(
                        RemoteVariant("u0", "旧问题", "2026-09-03T00:00:00Z", messageSource = "rikkahub")
                    )
                ),
                assistant = RemoteAssistantBranches(
                    activeByUserVariant = mapOf("0" to 1),
                    variantsByUserVariant = mapOf(
                        "0" to listOf(
                            RemoteVariant("a0", "第一版", "2026-09-03T00:00:10Z", messageSource = "rikkahub"),
                            RemoteVariant("a1", "第二版", "2026-09-03T00:00:20Z", messageSource = "rikkahub")
                        )
                    )
                )
            )
        )
    )

    @Test
    fun editingUserCreatesANewCanonicalBranchWithoutOverwritingImportedText() {
        val edited = ChatHistoryMutations.editActiveUser(branchedHistory(), "turn-1", "新的问题")
        val turn = edited.turns.single()

        assertEquals(2, turn.user.variants.size)
        assertEquals("旧问题", turn.user.variants[0].content)
        assertEquals("新的问题", turn.user.variants[1].content)
        assertEquals(1, turn.user.active)
        assertTrue(turn.assistant.variantsByUserVariant["1"].orEmpty().isEmpty())
        assertEquals(listOf("第一版", "第二版"), turn.assistant.variantsByUserVariant["0"].orEmpty().map { it.content })
    }

    @Test
    fun deletingTheOnlyUserVariantRemovesTheWholeTurn() {
        val deleted = ChatHistoryMutations.deleteActiveUser(branchedHistory(), "turn-1")
        assertTrue(deleted.turns.isEmpty())
    }

    @Test
    fun deletingAssistantRemovesOnlyTheActiveVariantAndKeepsTheBranch() {
        val deleted = ChatHistoryMutations.deleteActiveAssistant(branchedHistory(), "turn-1")
        val turn = deleted.turns.single()
        val assistants = turn.assistant.variantsByUserVariant["0"].orEmpty()

        assertEquals(listOf("第一版"), assistants.map { it.content })
        assertEquals(0, turn.assistant.activeByUserVariant["0"])
    }

    @Test
    fun groupedAlternativesNavigateAndDeleteTogether(){
        val base=branchedHistory()
        val turn=base.turns.single()
        val old=turn.assistant.variantsByUserVariant.getValue("0").first()
        val first=RemoteVariant("first","first",replySequence=com.elementeracoast.app.core.remote.RemoteReplySequence("seq",0))
        val second=first.copy(id="second",content="second",replySequence=first.replySequence!!.copy(index=1))
        val grouped=base.copy(turns=listOf(turn.copy(assistant=RemoteAssistantBranches(
            activeByUserVariant=mapOf("0" to 2),variantsByUserVariant=mapOf("0" to listOf(old,first,second))))))
        val role=com.elementeracoast.app.core.model.MessageRole.Assistant
        val ui=ChatSyncMapper.toUi(grouped).last()
        assertEquals(2,ui.variantCount)
        assertEquals(1,ui.variantIndex)
        val previous=ChatBranchNavigator.select(grouped,turn.id,role,0)
        assertEquals(0,previous.turns.single().assistant.activeByUserVariant["0"])
        val next=ChatBranchNavigator.select(previous,turn.id,role,1)
        assertEquals(2,next.turns.single().assistant.activeByUserVariant["0"])
        val removed=ChatHistoryMutations.deleteActiveAssistant(next,turn.id)
        assertEquals(listOf(old),removed.turns.single().assistant.variantsByUserVariant["0"])
    }

    @Test
    fun assistantReactionsMutateTheCanonicalActiveVariant() {
        val liked = ChatHistoryMutations.toggleActiveAssistantLike(branchedHistory(), "turn-1")
        val likedVariant = liked.turns.single().assistant.variantsByUserVariant["0"].orEmpty()[1]
        assertTrue(likedVariant.liked)
        assertFalse(likedVariant.favorite)

        val favorite = ChatHistoryMutations.toggleActiveAssistantFavorite(liked, "turn-1")
        val favoriteVariant = favorite.turns.single().assistant.variantsByUserVariant["0"].orEmpty()[1]
        assertTrue(favoriteVariant.liked)
        assertTrue(favoriteVariant.favorite)
    }
    @org.junit.Test
    fun groupedMessagesHaveIndependentIdentityAndExactReactions() {
        val original=branchedHistory()
        val turn=original.turns.single()
        val source=turn.assistant.variantsByUserVariant.getValue("0")
        val first=source[0].copy(replySequence=com.elementeracoast.app.core.remote.RemoteReplySequence("group",0))
        val second=source[1].copy(replySequence=com.elementeracoast.app.core.remote.RemoteReplySequence("group",1))
        val history=original.copy(turns=listOf(turn.copy(assistant=turn.assistant.copy(
            variantsByUserVariant=mapOf("0" to listOf(first,second)),
            activeByUserVariant=mapOf("0" to 1)))))
        val rows=ChatSyncMapper.toUi(history).filter{it.role==com.elementeracoast.app.core.model.MessageRole.Assistant}
        org.junit.Assert.assertEquals(listOf(first.id,second.id),rows.map{it.remoteVariantId})
        org.junit.Assert.assertEquals(2,rows.map{it.id}.distinct().size)
        org.junit.Assert.assertEquals(listOf(false,true),rows.map{it.replyGroupTail})
        val liked=ChatHistoryMutations.toggleActiveAssistantLike(history,turn.id,first.id)
        val variants=liked.turns.single().assistant.variantsByUserVariant.getValue("0")
        org.junit.Assert.assertTrue(variants[0].liked)
        org.junit.Assert.assertEquals(second.liked,variants[1].liked)
        val stale=ChatHistoryMutations.toggleActiveAssistantLike(liked,turn.id,"stale")
        org.junit.Assert.assertEquals(liked.turns,stale.turns)
    }

}
