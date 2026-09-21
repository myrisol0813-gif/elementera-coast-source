package com.elementeracoast.app.feature.dogtalk

import com.elementeracoast.app.core.model.RoomType

enum class DogtalkScope(val wireValue: String) {
    Main("conversation"),
    Radio("radio"),
    Lighthouse("lighthouse");

    companion object {
        fun from(roomType: RoomType): DogtalkScope = when (roomType) {
            RoomType.Main -> Main
            RoomType.Radio -> Radio
            RoomType.Lighthouse -> Lighthouse
        }
    }
}
