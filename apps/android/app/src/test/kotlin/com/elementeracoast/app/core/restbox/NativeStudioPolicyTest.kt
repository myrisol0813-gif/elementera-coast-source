package com.elementeracoast.app.core.restbox

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NativeStudioPolicyTest {
    private val root = sequenceOf(File("../../web/elementera-mcp/deploy-pages/public"),File("apps/web/elementera-mcp/deploy-pages/public")).first{it.isDirectory}
    private val repo=RestArtRepository{root.resolve(it).readText()}
    private val cat=NativeSceneCatalogue.load(repo)
    private val policy=NativeStudioPolicy(cat,repo.appearance())
    private val svg=NativeFurnitureSvg(repo)

    @Test fun nativeEditAndPortableArchiveRoundTrip(){
        val original=policy.fresh()
        val (added,id)=policy.add(original,"extra-gramophone")
        assertEquals(14,policy.items(added).size)
        val moved=policy.edit(added,id){it.copy(x=42.0,y=87.0,mirror=true,scale=.8)}
        val (copied,copy)=policy.duplicate(moved,id)
        assertEquals(15,policy.items(copied).size)
        val top=policy.reorder(copied,id,"top")
        assertEquals(id,policy.items(top).last().id)
        val removed=policy.remove(top,copy)
        assertEquals(14,policy.items(removed).size)
        assertEquals(removed.layout,policy.import(policy.export(removed),original).layout)
        assertEquals(removed,policy.decode(policy.encode(removed)))
        assertEquals(original.layout,policy.resetRoom(removed).layout)
    }

    @Test fun previewOccupantsNeverShareAnAnchor(){
        val original=policy.fresh()
        val pair=original.copy(household=original.household.copy(humanEnabled=true))
        val occupants=policy.occupants(pair)
        assertEquals(2,occupants.size)
        assertEquals(2,occupants.map{it.instanceId to it.anchorId}.distinct().size)
        assertTrue(occupants.all{o->cat.anchor(policy.items(pair).first{it.id==o.instanceId},o.anchorId)!=null})
        assertTrue(policy.occupants(pair.copy(pets=false)).isEmpty())
    }

    @Test fun unsupportedOrBadArchivesDoNotMutateExistingState(){
        val original=policy.fresh()
        assertThrows(IllegalArgumentException::class.java){policy.import("""{"version":99,"rooms":{}}""",original)}
        val invalid=original.copy(layout=original.layout.copy(rooms=original.layout.rooms+("living" to listOf(NativeFurniture("x","living-sofa",0.0,0.0,100.0)))))
        assertThrows(IllegalArgumentException::class.java){policy.validate(invalid)}
        assertEquals(13,policy.items(original).size)
    }

    @Test fun nativeSvgSplitAndColorPreparationDoNotChangeOriginalFile(){
        val sofa=cat.assets.getValue("living-sofa")
        val original=repo.svg(sofa.file)
        val back=svg.prepare(sofa,emptyMap(),NativePaintPart.BACK)
        val front=svg.prepare(sofa,emptyMap(),NativePaintPart.FRONT)
        assertTrue(back.contains("data-part=\"back\""))
        assertFalse(back.contains("data-part=\"front\""))
        assertTrue(front.contains("data-part=\"front\""))
        assertFalse(front.contains("data-part=\"back\""))
        assertEquals(original,repo.svg(sofa.file))
        val window=cat.assets.getValue("living-window")
        val changed=svg.prepare(window,mapOf("wood" to "#777777"),NativePaintPart.WHOLE)
        assertTrue(changed.contains("#777777"))
        assertThrows(IllegalArgumentException::class.java){svg.prepare(window,mapOf("bad-slot" to "#777777"),NativePaintPart.WHOLE)}
        assertEquals("#ffffff",NativeFurnitureSvg.shiftInk("#eeeeee","#000000","#ffffff"))
    }

    @Test fun portableBackupIncludesRoomMotionAndOccupantPreferences(){
        val original=policy.fresh()
        val study=original.copy(room="study",pets=false,reducedMotion=true,
            poseChoices=mapOf("study" to mapOf("model" to "none")))
        assertEquals(policy.validate(study),policy.import(policy.export(study),original))
        // Old room-only exports remain accepted without resetting the household.
        val old=kotlinx.serialization.json.Json.encodeToString(NativeRoomLayout.serializer(),study.layout)
        assertEquals(original.household,policy.import(old,original).household)
    }
}
