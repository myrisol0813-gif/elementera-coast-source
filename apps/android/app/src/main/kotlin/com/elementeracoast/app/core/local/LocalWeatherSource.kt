package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteRealityWeather
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** Only uses the explicitly configured city, never the device's location or credentials. */
internal class LocalWeatherSource(
    private val http:OkHttpClient=OkHttpClient.Builder().callTimeout(6,TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build(),
    private val clock:()->Long=System::currentTimeMillis
){
    private data class Cached(val result:RemoteRealityWeather,val expires:Long)
    private val cache=linkedMapOf<String,Cached>()
    @Synchronized fun read(city:String):RemoteRealityWeather?{
        val key=city.trim().take(80)
        if(key.isBlank())return null
        cache[key]?.takeIf{it.expires>clock()}?.let{return it.result}
        return runCatching{
            val lookup="https://geocoding-api.open-meteo.com/v1/search".toHttpUrl().newBuilder()
                .addQueryParameter("name",key).addQueryParameter("count","1")
                .addQueryParameter("language","zh").addQueryParameter("format","json").build()
            val location=get(lookup).getValue("results").jsonArray.first().jsonObject
            val lat=location.getValue("latitude").jsonPrimitive.double
            val lon=location.getValue("longitude").jsonPrimitive.double
            require(lat.isFinite()&&lat in -90.0..90.0&&lon.isFinite()&&lon in -180.0..180.0)
            val url="https://api.open-meteo.com/v1/forecast".toHttpUrl().newBuilder()
                .addQueryParameter("latitude",lat.toString()).addQueryParameter("longitude",lon.toString())
                .addQueryParameter("current","temperature_2m,apparent_temperature,weather_code")
                .addQueryParameter("temperature_unit","celsius").addQueryParameter("timezone","auto").build()
            val current=get(url).getValue("current").jsonObject
            val temp=current.getValue("temperature_2m").jsonPrimitive.double
            require(temp.isFinite()&&temp in -100.0..100.0)
            val apparent=current["apparent_temperature"]?.jsonPrimitive?.doubleOrNull?.takeIf{it.isFinite()&&it in -120.0..120.0}
            val code=current["weather_code"]?.jsonPrimitive?.intOrNull
            val label=listOf("name","admin1","country").mapNotNull{location[it]?.jsonPrimitive?.contentOrNull?.trim()?.take(60)?.takeIf(String::isNotBlank)}.distinct().joinToString(" · ").ifBlank{key}
            val condition=when(code){
                0->"晴";1->"大致晴朗";2->"局部多云";3->"阴";45,48->"雾";51,53,55,56,57->"毛毛雨"
                61,63,65,66,67->"雨";71,73,75,77->"雪";80,81,82->"阵雨";85,86->"阵雪";95,96,99->"雷雨";else->""
            }
            RemoteRealityWeather(label,listOf(condition,temp.roundToInt().toString()+"°C",
                apparent?.let{"体感 "+it.roundToInt()+"°C"}.orEmpty()).filter{it.isNotBlank()}.joinToString(" · ")).also{
                while(cache.size>=24)cache.remove(cache.keys.first())
                cache[key]=Cached(it,clock()+600000)
            }
        }.getOrNull()
    }
    private fun get(url:okhttp3.HttpUrl):JsonObject=http.newCall(Request.Builder().url(url).header("Accept","application/json").build()).execute().use{
        require(it.isSuccessful)
        val source=requireNotNull(it.body).source();source.request(65537)
        require(source.buffer.size<=65536)
        Json.parseToJsonElement(source.readUtf8()).jsonObject
    }
}
