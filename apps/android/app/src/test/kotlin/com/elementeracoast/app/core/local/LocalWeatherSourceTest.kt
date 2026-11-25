package com.elementeracoast.app.core.local

import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class LocalWeatherSourceTest {
    @Test fun explicitCityOnlyAndCacheExpires(){
        var time=0L;var count=0
        val http=OkHttpClient.Builder().addInterceptor{chain->
            val r=chain.request();count++
            assertNull(r.header("Authorization"));assertNull(r.header("Cookie"))
            val content=when(r.url.host){
                "geocoding-api.open-meteo.com"->{assertEquals("测试城",r.url.queryParameter("name"));"""{"results":[{"name":"测试城","latitude":1,"longitude":2}]}"""}
                "api.open-meteo.com"->{assertEquals("1.0",r.url.queryParameter("latitude"));"""{"current":{"temperature_2m":13,"apparent_temperature":12,"weather_code":3}}"""}
                else->error("unexpected host")
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok").body(content.toResponseBody()).build()
        }.build()
        val weather=LocalWeatherSource(http){time}
        assertNull(weather.read(""));assertEquals(0,count)
        assertTrue(weather.read("测试城")!!.summary.contains("13°C"));assertEquals(2,count)
        assertNotNull(weather.read("测试城"));assertEquals(2,count)
        time=600001;assertNotNull(weather.read("测试城"));assertEquals(4,count)
    }
    @Test fun networkFailureDoesNotInventWeather(){
        val http=OkHttpClient.Builder().addInterceptor{throw java.io.IOException("offline")}.build()
        assertNull(LocalWeatherSource(http).read("测试城"))
    }
}
