package com.thisux.droidclaw.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import com.thisux.droidclaw.model.UIElement
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

class DroidClawAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "DroidClawA11y"
        private const val SNAPSHOT_FILE_NAME = "ui_snapshot.json"
        private const val SNAPSHOT_DEBOUNCE_MS = 300L
        val isRunning = MutableStateFlow(false)
        val lastScreenTree = MutableStateFlow<List<UIElement>>(emptyList())
        var instance: DroidClawAccessibilityService? = null

        fun isEnabledOnDevice(context: Context): Boolean {
            val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            val ourComponent = ComponentName(context, DroidClawAccessibilityService::class.java)
            return am.getEnabledAccessibilityServiceList(AccessibilityEvent.TYPES_ALL_MASK)
                .any { it.resolveInfo.serviceInfo.let { si ->
                    ComponentName(si.packageName, si.name) == ourComponent
                }}
        }
    }

    @Serializable
    private data class UiSnapshot(
        val version: Int = 1,
        val timestampMs: Long,
        val packageName: String = "",
        val screenHash: String,
        val elements: List<UIElement>
    )

    private val mainHandler = Handler(Looper.getMainLooper())
    private val writeSnapshotRunnable = Runnable {
        writeSnapshotFromActiveWindow()
    }
    private val json = Json { encodeDefaults = true }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "Accessibility service connected")
        instance = this
        isRunning.value = true
        scheduleSnapshotWrite()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        when (event?.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED -> {
                Log.d(
                    TAG,
                    "Event ${eventTypeName(event.eventType)} from ${event.packageName ?: "unknown"}"
                )
                // Window/focus changes are high-signal: write immediately so the host
                // doesn't keep reading a stale snapshot from the previous app/screen.
                mainHandler.removeCallbacks(writeSnapshotRunnable)
                writeSnapshotFromActiveWindow()
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> {
                Log.d(
                    TAG,
                    "Event ${eventTypeName(event.eventType)} from ${event.packageName ?: "unknown"}"
                )
                // Content updates can be very noisy (e.g., TikTok). Debounce them.
                scheduleSnapshotWrite()
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Accessibility service destroyed")
        mainHandler.removeCallbacks(writeSnapshotRunnable)
        instance = null
        isRunning.value = false
    }

    fun getScreenTree(): List<UIElement> {
        // Retry with increasing delays — apps like Contacts on Vivo
        // can take 500ms+ to render after a cold launch
        val delays = longArrayOf(50, 100, 200, 300, 500)
        for (delayMs in delays) {
            val root = rootInActiveWindow
            if (root != null) {
                try {
                    val elements = ScreenTreeBuilder.capture(root)
                    // If we got a root but zero elements, the app may still be loading.
                    // Retry unless this is the last attempt.
                    if (elements.isEmpty() && delayMs < delays.last()) {
                        root.recycle()
                        runBlocking { delay(delayMs) }
                        continue
                    }
                    lastScreenTree.value = elements
                    return elements
                } finally {
                    root.recycle()
                }
            }
            runBlocking { delay(delayMs) }
        }
        Log.w(TAG, "rootInActiveWindow null or empty after retries")
        return emptyList()
    }

    fun findNodeAt(x: Int, y: Int): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        return findNodeAtRecursive(root, x, y)
    }

    private fun findNodeAtRecursive(
        node: AccessibilityNodeInfo,
        x: Int,
        y: Int
    ): AccessibilityNodeInfo? {
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)

        if (!rect.contains(x, y)) {
            node.recycle()
            return null
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNodeAtRecursive(child, x, y)
            if (found != null) {
                node.recycle()
                return found
            }
        }

        return if (node.isClickable || node.isLongClickable || node.isEditable) {
            node
        } else {
            node.recycle()
            null
        }
    }

    private fun scheduleSnapshotWrite() {
        mainHandler.removeCallbacks(writeSnapshotRunnable)
        mainHandler.postDelayed(writeSnapshotRunnable, SNAPSHOT_DEBOUNCE_MS)
    }

    private fun writeSnapshotFromActiveWindow() {
        val root = rootInActiveWindow ?: return
        try {
            val elements = ScreenTreeBuilder.capture(root)
            lastScreenTree.value = elements

            val pkg = root.packageName?.toString().orEmpty()
            val snapshot = UiSnapshot(
                timestampMs = System.currentTimeMillis(),
                packageName = pkg,
                screenHash = ScreenTreeBuilder.computeScreenHash(elements),
                elements = elements
            )

            val dir = getExternalFilesDir(null) ?: return
            if (!dir.exists()) dir.mkdirs()
            val outFile = File(dir, SNAPSHOT_FILE_NAME)
            outFile.writeText(json.encodeToString(snapshot))
            Log.d(TAG, "Snapshot written: pkg=${snapshot.packageName} elements=${elements.size}")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to write accessibility snapshot", e)
        } finally {
            try {
                root.recycle()
            } catch (_: Exception) {
            }
        }
    }

    private fun eventTypeName(eventType: Int): String = when (eventType) {
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "TYPE_WINDOW_STATE_CHANGED"
        AccessibilityEvent.TYPE_WINDOWS_CHANGED -> "TYPE_WINDOWS_CHANGED"
        AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "TYPE_WINDOW_CONTENT_CHANGED"
        AccessibilityEvent.TYPE_VIEW_SCROLLED -> "TYPE_VIEW_SCROLLED"
        AccessibilityEvent.TYPE_VIEW_FOCUSED -> "TYPE_VIEW_FOCUSED"
        else -> "TYPE_$eventType"
    }
}
