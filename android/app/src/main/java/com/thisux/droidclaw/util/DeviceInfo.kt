package com.thisux.droidclaw.util

import android.content.Context
import android.util.DisplayMetrics
import android.view.WindowManager
import com.thisux.droidclaw.model.DeviceInfoMsg

object DeviceInfoHelper {
    fun get(context: Context): DeviceInfoMsg {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        return DeviceInfoMsg(
            model = android.os.Build.MODEL,
            androidVersion = android.os.Build.VERSION.RELEASE,
            screenWidth = metrics.widthPixels,
            screenHeight = metrics.heightPixels
        )
    }
}
