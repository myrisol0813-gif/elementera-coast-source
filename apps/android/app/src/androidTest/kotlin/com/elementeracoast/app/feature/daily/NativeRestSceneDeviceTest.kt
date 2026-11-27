package com.elementeracoast.app.feature.daily

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.elementeracoast.app.core.restbox.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeRestSceneDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun threeNativeRoomsActuallyPaintAndFurnitureIsNotFlattened() {
        val repo=RestArtRepository(context.assets)
        val cat=NativeSceneCatalogue.load(repo)
        val policy=NativeStudioPolicy(cat,repo.appearance())
        val atlas=NativeRestSprites(context.assets)
        val initial=policy.fresh()
        fun load(room:String,items:List<NativeFurniture>):NativeRestSpriteSnapshot {
            val keys=buildSet {
                for(layer in cat.layers(room,items,emptyList()))when(layer) {
                    is NativeSceneLayer.Environment -> add(atlas.environmentKey(layer.path))
                    is NativeSceneLayer.Furniture -> layer.asset?.let{add(atlas.furnitureKey(it,layer.part,emptyMap()))}
                    is NativeSceneLayer.Occupant -> Unit
                }
            }
            val decoded=atlas.load(keys)
            assertEquals("Every visible layer must decode",keys,decoded.keys)
            return NativeRestSpriteSnapshot(atlas,decoded,initial.household)
        }
        val room=mutableStateOf("living")
        val items=mutableStateOf(cat.defaults("living"))
        val images=mutableStateOf(load("living",items.value))
        compose.setContent {
            MaterialTheme {
                NativeRestScene(cat,room.value,items.value,emptyList(),images.value,false,null,
                    onSelect={},onMove={_,_,_->},onMoveFinished={},modifier=Modifier.testTag("native-room"))
            }
        }
        fun colors():List<Int> {
            val image=compose.onNodeWithTag("native-room").captureToImage()
            assertTrue("Native room has real dimensions",image.width>100&&image.height>100)
            val pixels=image.toPixelMap()
            return buildList {
                for(y in 1..19)for(x in 1..19)add(pixels[image.width*x/20,image.height*y/20].value.hashCode())
            }
        }
        val roomSignatures=mutableSetOf<List<Int>>()
        for(id in cat.rooms.keys) {
            val defaults=cat.defaults(id)
            val snapshot=load(id,defaults)
            compose.runOnIdle {room.value=id;items.value=defaults;images.value=snapshot}
            val signature=colors()
            assertTrue("$id is visibly painted, not blank",signature.distinct().size>20)
            roomSignatures.add(signature)
        }
        assertEquals("Room backgrounds are distinct",3,roomSignatures.size)
        val defaults=cat.defaults("living")
        val snapshot=load("living",defaults)
        compose.runOnIdle {room.value="living";items.value=defaults;images.value=snapshot}
        val withFurniture=colors()
        compose.runOnIdle {items.value=defaults.map{it.copy(visible=false)}}
        assertNotEquals("Furniture is separate from the environment",withFurniture,colors())
    }

    @Test fun allAuthoredAnimalPalettesAndSixPosesArePackagedAndDecode() {
        val repo=RestArtRepository(context.assets)
        val atlas=NativeRestSprites(context.assets)
        val cat=repo.appearance()
        assertEquals(16,cat.bodies.size)
        for((id,body) in cat.bodies)for(palette in body.palettes.keys)for(action in body.actions) {
            val appearance=RestAppearancePolicy.fresh(cat,id).copy(palette=palette)
            val key=atlas.creatureKey(appearance,action)
            val bitmap=atlas.get(key)
            assertNotNull(key,bitmap)
            assertTrue(key,bitmap!!.width>0&&bitmap.height>0)
        }
    }

    @Test fun nativeCustomFurnitureAndAnimalAppearanceActuallyPaint() {
        val repo=RestArtRepository(context.assets)
        val cat=NativeSceneCatalogue.load(repo)
        val atlas=NativeRestSprites(context.assets)
        val window=cat.assets.getValue("living-window")
        val base=atlas.get(atlas.furnitureKey(window,NativePaintPart.WHOLE,emptyMap()))!!
        val color=atlas.get(atlas.furnitureKey(window,NativePaintPart.WHOLE,mapOf("wood" to "#7389b0")))
        assertNotNull("Native free recolor must render, not fall back",color)
        assertEquals(base.width,color!!.width)
        assertEquals(base.height,color.height)
        fun signature(bitmap:android.graphics.Bitmap):List<Int> = buildList {
            for(y in 1..19)for(x in 1..19)add(bitmap.getPixel(bitmap.width*x/20,bitmap.height*y/20))
        }
        assertNotEquals(signature(base),signature(color))
        val appearance=repo.appearance()
        val wolf=RestAppearancePolicy.fresh(appearance,"wolf")
        val custom=wolf.copy(colors=mapOf("fur" to "#7389b0"),glasses="round",neck="scarf",
            badge="gpt",badgePlace="head",badgeMode="custom",badgeColor="#ba8371",badgeX=3.0,badgeY=-2.0)
        val original=atlas.get(atlas.baseCreatureKey(wolf,"idle"))!!
        val edited=atlas.get(atlas.creatureKey(custom,"idle","book"))
        assertNotNull("Body colors, glasses, scarf, badge and prop must compose natively",edited)
        assertNotEquals(signature(original),signature(edited!!))
        val f1=atlas.motionFrame(custom,"idle",null,100,256)
        val f2=atlas.motionFrame(custom,"idle",null,900,256)
        assertNotNull("Native authored animation should paint",f1)
        assertNotNull(f2)
        assertNotEquals("Animation must actually change pixels",signature(f1!!),signature(f2!!))
    }
}
