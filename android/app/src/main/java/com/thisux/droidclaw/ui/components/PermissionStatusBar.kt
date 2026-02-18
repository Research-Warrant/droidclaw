package com.thisux.droidclaw.ui.components

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.thisux.droidclaw.DroidClawApp
import com.thisux.droidclaw.accessibility.DroidClawAccessibilityService
import com.thisux.droidclaw.capture.ScreenCaptureManager
import com.thisux.droidclaw.ui.theme.StatusGreen
import com.thisux.droidclaw.ui.theme.StatusRed
import com.thisux.droidclaw.util.BatteryOptimization

@Composable
fun PermissionStatusBar(onNavigateToSettings: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as DroidClawApp
    val apiKey by app.settingsStore.apiKey.collectAsState(initial = "")
    val isCaptureAvailable by ScreenCaptureManager.isAvailable.collectAsState()

    var isAccessibilityEnabled by remember {
        mutableStateOf(DroidClawAccessibilityService.isEnabledOnDevice(context))
    }
    var hasCaptureConsent by remember {
        ScreenCaptureManager.restoreConsent(context)
        mutableStateOf(isCaptureAvailable || ScreenCaptureManager.hasConsent())
    }
    var isBatteryExempt by remember {
        mutableStateOf(BatteryOptimization.isIgnoringBatteryOptimizations(context))
    }
    var hasOverlayPermission by remember {
        mutableStateOf(Settings.canDrawOverlays(context))
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isAccessibilityEnabled = DroidClawAccessibilityService.isEnabledOnDevice(context)
                ScreenCaptureManager.restoreConsent(context)
                hasCaptureConsent = isCaptureAvailable || ScreenCaptureManager.hasConsent()
                isBatteryExempt = BatteryOptimization.isIgnoringBatteryOptimizations(context)
                hasOverlayPermission = Settings.canDrawOverlays(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val allOk = apiKey.isNotBlank() && isAccessibilityEnabled && hasCaptureConsent
            && hasOverlayPermission

    if (allOk) {
        Icon(
            imageVector = Icons.Filled.CheckCircle,
            contentDescription = "All permissions OK",
            tint = StatusGreen,
            modifier = Modifier
                .size(24.dp)
                .clickable { onNavigateToSettings() }
        )
    } else {
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.clickable { onNavigateToSettings() }
        ) {
            if (apiKey.isBlank()) StatusDot(StatusRed)
            if (!isAccessibilityEnabled) StatusDot(StatusRed)
            if (!hasCaptureConsent) StatusDot(StatusRed)
            if (!hasOverlayPermission) StatusDot(StatusRed)
        }
    }
}

@Composable
private fun StatusDot(color: androidx.compose.ui.graphics.Color) {
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color)
    )
}
