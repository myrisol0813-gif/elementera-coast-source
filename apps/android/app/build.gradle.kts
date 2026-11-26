import java.io.File
import java.security.MessageDigest
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val sourceApiBaseUrl = providers.gradleProperty("COAST_API_BASE_URL")
    .orElse("https://elementera-coast-source.invalid")
val sourceSigningPath = providers.environmentVariable("COAST_SOURCE_KEYSTORE_PATH")
val sourceStorePassword = providers.environmentVariable("COAST_SOURCE_STORE_PASSWORD")
val sourceKeyAlias = providers.environmentVariable("COAST_SOURCE_KEY_ALIAS")
val sourceKeyPassword = providers.environmentVariable("COAST_SOURCE_KEY_PASSWORD")
val sourceSigningConfigured = listOf(sourceSigningPath, sourceStorePassword, sourceKeyAlias, sourceKeyPassword).all { it.isPresent }
val sourcePreviewPasswordHint = providers.gradleProperty("SOURCE_PREVIEW_PASSWORD_HINT")
    .orElse("")
val sourceTourEnabled = providers.gradleProperty("SOURCE_TOUR_ENABLED")
    .orElse("true")
    .map { it.equals("true", ignoreCase = true) }

android {
    namespace = "com.elementeracoast.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.elementeracoast.source"
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        targetSdk = 34
        versionCode = 47
        versionName = "0.2.45-source"
        buildConfigField("String", "COAST_API_BASE_URL", "\"${sourceApiBaseUrl.get()}\"")
        buildConfigField("String", "SOURCE_PREVIEW_PASSWORD_HINT", "\"${sourcePreviewPasswordHint.get()}\"")
        buildConfigField("boolean", "SOURCE_TOUR_ENABLED", sourceTourEnabled.get().toString())
    }

    signingConfigs {
        getByName("debug") {
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
        if (sourceSigningConfigured) {
            create("sourceStable") {
                storeFile = file(sourceSigningPath.get())
                storePassword = sourceStorePassword.get()
                keyAlias = sourceKeyAlias.get()
                keyPassword = sourceKeyPassword.get()
            }
        }
    }

    buildTypes {
        debug { isMinifyEnabled = false }
        release {
            if (sourceSigningConfigured) signingConfig = signingConfigs.getByName("sourceStable")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        // Compress native libraries in the downloadable APK; Android extracts the matching ABI at install.
        // Preserve all upstream supported ABIs and the same signed package identity.
        jniLibs.useLegacyPackaging = true
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/DEPENDENCIES")
    }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
    val composeBom = platform("androidx.compose:compose-bom:2024.09.02")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

// Report failing test messages and stack traces in CI, not just source line numbers.
tasks.withType<org.gradle.api.tasks.testing.Test>().configureEach {
    testLogging {
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showCauses = true
        showStackTraces = true
    }
}

/** Model assets are verified at build time, never fetched by the installed app. */
val coastEmbeddingAssets = layout.buildDirectory.dir("generated/coast-embedding-assets")
val coastEmbeddingRevision = "75c43b069aac4d136ba6bc1122f995fedcfd2781"
val coastEmbeddingFiles = mapOf(
    "onnx/model_quantized.onnx" to Pair("model.onnx", "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc"),
    "vocab.txt" to Pair("vocab.txt", "45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c")
)
val prepareCoastEmbedding by tasks.registering {
    inputs.property("revision", coastEmbeddingRevision)
    inputs.property("files", coastEmbeddingFiles.toString())
    outputs.dir(coastEmbeddingAssets)
    doLast {
        val target = coastEmbeddingAssets.get().asFile.resolve("coast-embedding")
        target.mkdirs()
        fun digest(file: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(65536)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    md.update(buffer, 0, n)
                }
            }
            return md.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        }
        for ((remote, pair) in coastEmbeddingFiles) {
            val (name, expected) = pair
            val file = target.resolve(name)
            if (file.isFile && digest(file) == expected) continue
            val temp = target.resolve(name + ".tmp")
            try {
                val connection = URI("https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/$coastEmbeddingRevision/$remote").toURL().openConnection()
                connection.connectTimeout = 30000
                connection.readTimeout = 90000
                connection.setRequestProperty("User-Agent", "Coast-Android-build/1.0")
                connection.getInputStream().use { input -> temp.outputStream().use { output ->
                    val buffer = ByteArray(65536)
                    var count = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        count += n
                        check(count <= 30_000_000) { "Embedding asset too large" }
                        output.write(buffer, 0, n)
                    }
                } }
                check(digest(temp) == expected) { "Embedding asset SHA256 mismatch: $name" }
                Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            } finally { temp.delete() }
        }
    }
}
android.sourceSets.getByName("main").assets.srcDir(coastEmbeddingAssets)
tasks.matching { it.name in setOf("preBuild", "preDebugBuild", "preReleaseBuild") }.configureEach {
    dependsOn(prepareCoastEmbedding)
}
