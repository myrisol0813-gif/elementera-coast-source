package com.elementeracoast.app.feature.wolf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import org.junit.Assert.*
import org.junit.Test

class LocalGithubUpdaterTest {
    @Test fun choosesOnlyFormalChannelAndHighestVersion() {
        fun release(tag: String, apk: String) = """{"tag_name":"$tag","draft":false,"assets":[{"name":"$apk"},{"name":"BUILD_INFO.txt"},{"name":"SHA256SUMS.txt"}]}"""
        val all = Json.parseToJsonElement(listOf(
            release("coast-post-v1-acceptance-999", "CoastGPT-native-x-debug.apk"),
            release("coast-v1-closeout-native-117", "CoastGPT-native-a-debug.apk"),
            release("coast-v1-closeout-native-118", "CoastGPT-native-b-debug.apk"),
            release("source-native-v0.2.26-" + "a".repeat(40), "elementera-coast-source-v0.2.26-release.apk")
        ).joinToString(",", "[", "]")).jsonArray
        assertEquals("coast-v1-closeout-native-118", selectGithubRelease(all, false)?.tag)
        assertEquals("elementera-coast-source-v0.2.26-release.apk", selectGithubRelease(all, true)?.apk)
    }
    @Test fun rejectsWrongPackageOrMissingHash() {
        val a = GithubReleaseAssets("coast-v1-closeout-native-118", "CoastGPT-native-b-debug.apk", "", 118)
        val info = "applicationId=com.elementeracoast.app\nversionCode=118\nversionName=0.1.116\nstable_signing=true\nsignature_verified=true"
        val sum = "a".repeat(64) + "  " + a.apk
        assertEquals(118, parseLocalRelease(a, info, sum, "com.elementeracoast.app", false).code)
        assertTrue(runCatching { parseLocalRelease(a, info, sum, "wrong.package", false) }.isFailure)
        assertTrue(runCatching { parseLocalRelease(a, info, "", "com.elementeracoast.app", false) }.isFailure)
    }
}
