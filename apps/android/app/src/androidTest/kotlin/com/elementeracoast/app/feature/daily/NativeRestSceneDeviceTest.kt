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
        assertReferenceFidelity(atlas.get("reference|furniture|window")!!,color,"window recolor")
        val appearance=repo.appearance()
        val wolf=RestAppearancePolicy.fresh(appearance,"wolf")
        val custom=wolf.copy(colors=mapOf("fur" to "#7389b0"),glasses="round",neck="scarf",
            badge="gpt",badgePlace="head",badgeMode="custom",badgeColor="#ba8371",badgeX=3.0,badgeY=-2.0)
        val original=atlas.get(atlas.baseCreatureKey(wolf,"idle"))!!
        val edited=atlas.get(atlas.creatureKey(custom,"idle","book"))
        assertNotNull("Body colors, glasses, scarf, badge and prop must compose natively",edited)
        assertNotEquals(signature(original),signature(edited!!))
        assertReferenceFidelity(atlas.get("reference|creature|wolf")!!,edited,"wolf wardrobe composition")
        val f1=atlas.motionFrame(custom,"idle",null,100,256)
        val f2=atlas.motionFrame(custom,"idle",null,900,256)
        assertNotNull("Native authored animation should paint",f1)
        assertNotNull(f2)
        assertNotEquals("Animation must actually change pixels",signature(f1!!),signature(f2!!))
    }

    /** Catch gross shape, occlusion or color regression; owner still decides visual parity. */
    private fun assertReferenceFidelity(reference:android.graphics.Bitmap,actual:android.graphics.Bitmap,label:String){
        assertEquals("$label width",reference.width,actual.width)
        assertEquals("$label height",reference.height,actual.height)
        var union=0L;var overlap=0L;var colorError=0L
        for(y in 0 until reference.height step 2)for(x in 0 until reference.width step 2){
            val a=reference.getPixel(x,y);val b=actual.getPixel(x,y)
            val aa=android.graphics.Color.alpha(a);val ab=android.graphics.Color.alpha(b)
            if(aa>32||ab>32)union++
            if(aa>32&&ab>32)overlap++
            if(aa>32&&ab>32){
                colorError+=kotlin.math.abs(android.graphics.Color.red(a)-android.graphics.Color.red(b))
                colorError+=kotlin.math.abs(android.graphics.Color.green(a)-android.graphics.Color.green(b))
                colorError+=kotlin.math.abs(android.graphics.Color.blue(a)-android.graphics.Color.blue(b))
            }
        }
        assertTrue("$label is not empty",union>100&&overlap>100)
        val silhouette=overlap.toDouble()/union
        val mean=colorError.toDouble()/(overlap*3)
        assertTrue("$label silhouette IoU $silhouette",silhouette>=.85)
        assertTrue("$label mean RGB error $mean",mean<=30.0)
    }

    @Test fun authoredFurnitureMotionChangesPixelsIndependently(){
        val repo=RestArtRepository(context.assets)
        val cat=NativeSceneCatalogue.load(repo)
        val atlas=NativeRestSprites(context.assets)
        val curtains=cat.assets.getValue("living-curtains")
        val key=atlas.furnitureKey(curtains,NativePaintPart.WHOLE,emptyMap())
        val motion=atlas.roomMotionKeys(cat.layers("living",cat.defaults("living"),emptyList()))
        assertTrue("Original curtain should carry a motion track",key in motion)
        val a=atlas.roomMotionFrame(key,0)
        val b=atlas.roomMotionFrame(key,2700)
        assertNotNull("First curtain frame",a);assertNotNull("Second curtain frame",b)
        assertFalse("Curtain motion must change its own transparent pixels",a!!.sameAs(b))
    }
}
