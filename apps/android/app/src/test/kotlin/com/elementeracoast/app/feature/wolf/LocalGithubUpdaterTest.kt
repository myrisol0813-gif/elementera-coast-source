package com.elementeracoast.app.feature.wolf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import org.junit.Assert.*
import org.junit.Test

class LocalGithubUpdaterTest {
    @Test fun streamsLargeApkWithoutAllocatingPackage() {
        val size = 81L * 1024 * 1024
        val block = ByteArray(64 * 1024)
        val hash = java.security.MessageDigest.getInstance("SHA-256")
        repeat((size / block.size).toInt()) { hash.update(block) }
        val expected = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        var left = size
        val input = object : java.io.InputStream() {
            override fun read(): Int = if (left == 0L) -1 else { left--; 0 }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (left == 0L) return -1
                val n = minOf(left, len.toLong()).toInt()
                b.fill(0, off, off + n); left -= n; return n
            }
        }
        var written = 0L
        val output = object : java.io.OutputStream() {
            override fun write(b: Int) { written++ }
            override fun write(b: ByteArray, off: Int, len: Int) { written += len }
        }
        streamApk(input, output, size, expected)
        assertEquals(size, written)
    }

    @Test fun rejectsOversizeTruncationAndWrongHash() {
        fun attempt(length: Long, max: Long, sha: String) = runCatching {
            streamApk(byteArrayOf(1, 2, 3).inputStream(), java.io.ByteArrayOutputStream(), length, sha, max)
        }
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(byteArrayOf(1, 2, 3))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        assertTrue(attempt(-1, 3, hash).isSuccess)
        assertTrue(attempt(3, 2, hash).isFailure)
        assertTrue(attempt(-1, 2, hash).isFailure)
        assertTrue(attempt(4, 4, hash).isFailure)
        assertTrue(attempt(3, 3, "0".repeat(64)).isFailure)
        assertTrue(runCatching {
            streamApk(byteArrayOf(1, 2, 3).inputStream(), java.io.ByteArrayOutputStream(), 3, hash) {
                throw java.util.concurrent.CancellationException()
            }
        }.isFailure)
    }

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
