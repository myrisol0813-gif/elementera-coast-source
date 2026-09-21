package com.elementeracoast.app.core.network

import com.elementeracoast.app.core.auth.AuthStore
import java.util.concurrent.TimeUnit
import okhttp3.Interceptor
import okhttp3.OkHttpClient

class CoastHttpClient(
    config: CoastApiConfig,
    authStore: AuthStore,
    baseClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
) {
    val client: OkHttpClient = baseClient.newBuilder()
        .addInterceptor(Interceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()
                .header("Accept", original.header("Accept") ?: "application/json")
                .header("X-Coast-Client", "native-android")
            if (original.header("Cookie") == null) {
                authStore.load()?.cookieHeader?.takeIf(String::isNotBlank)?.let { builder.header("Cookie", it) }
            }
            if (original.method !in setOf("GET", "HEAD") && original.header("Origin") == null) {
                builder.header("Origin", config.origin)
            }
            chain.proceed(builder.build())
        })
        .build()
}
