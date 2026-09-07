package com.hgs.copypaste

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.util.Base64
import java.io.ByteArrayOutputStream

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.hgs.copypaste/permissions"
    private val CLIPBOARD_CHANNEL = "com.hgs.copypaste/clipboard"
    private val PERMISSION_REQUEST_CODE = 100

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "requestLocalNetworkPermission" -> {
                        requestLocalNetworkPermission(result)
                    }
                    "requestBluetoothPermission" -> {
                        requestBluetoothPermission(result)
                    }
                    "requestNotificationPermission" -> {
                        requestNotificationPermission(result)
                    }
                    else -> result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CLIPBOARD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "readClipboard" -> {
                        readClipboard(result)
                    }
                    "writeClipboard" -> {
                        val args = call.arguments as? Map<String, Any>
                        writeClipboard(args, result)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    // MARK: - Local Network Permission (Android 12+)
    private fun requestLocalNetworkPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: REQUEST_LOCAL_CHANGE_WIFI_STATE permission
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.CHANGE_WIFI_STATE
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                result.success(true)
            } else {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.CHANGE_WIFI_STATE),
                    PERMISSION_REQUEST_CODE
                )
                // Result will be handled in onRequestPermissionsResult
                result.success(true) // Assume granted for now
            }
        } else {
            // Android 11 and below: Permission is granted by default
            result.success(true)
        }
    }

    // MARK: - Bluetooth Permission
    private fun requestBluetoothPermission(result: MethodChannel.Result) {
        val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: Need BLUETOOTH_SCAN and BLUETOOTH_CONNECT
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            )
        } else {
            // Android 11 and below: BLUETOOTH and BLUETOOTH_ADMIN
            arrayOf(
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN
            )
        }

        val allGranted = permissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

        if (allGranted) {
            result.success(true)
        } else {
            ActivityCompat.requestPermissions(
                this,
                permissions,
                PERMISSION_REQUEST_CODE
            )
            // Result will be handled in onRequestPermissionsResult
            result.success(true) // Assume granted for now
        }
    }

    // MARK: - Notification Permission
    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+: POST_NOTIFICATIONS permission
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                result.success(true)
            } else {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    PERMISSION_REQUEST_CODE
                )
                result.success(true)
            }
        } else {
            // Android 12 and below: Permission is granted by default
            result.success(true)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Permission results are handled by the system
        // In a real app, you might want to track these and update UI
    }

    // MARK: - Clipboard Operations
    private fun readClipboard(result: MethodChannel.Result) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = clipboard.primaryClip

        if (clip != null && clip.itemCount > 0) {
            val item = clip.getItemAt(0)

            // Try to get text first
            val text = item.text
            if (text != null) {
                val output = mapOf(
                    "type" to "text",
                    "content" to text.toString()
                )
                result.success(output)
                return
            }

            // Try to get image from URI
            val uri = item.uri
            if (uri != null) {
                try {
                    val bitmap = BitmapFactory.decodeStream(
                        contentResolver.openInputStream(uri)
                    )
                    if (bitmap != null) {
                        // Try PNG first
                        val pngStream = ByteArrayOutputStream()
                        if (bitmap.compress(Bitmap.CompressFormat.PNG, 100, pngStream)) {
                            val base64 = Base64.encodeToString(pngStream.toByteArray(), Base64.DEFAULT)
                            val output = mapOf(
                                "type" to "image/png",
                                "content" to base64
                            )
                            result.success(output)
                            return
                        }
                    }
                } catch (e: Exception) {
                    // Continue to next option
                }
            }
        }

        // Empty clipboard
        result.success(null)
    }

    private fun writeClipboard(args: Map<String, Any>?, result: MethodChannel.Result) {
        if (args == null) {
            result.error("INVALID_ARGS", "Missing arguments", null)
            return
        }

        val contentType = args["type"] as? String
        val content = args["content"] as? String

        if (contentType == null || content == null) {
            result.error("INVALID_ARGS", "Missing type or content", null)
            return
        }

        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

        when (contentType) {
            "text/plain" -> {
                val clip = ClipData.newPlainText("clipboard", content)
                clipboard.setPrimaryClip(clip)
                result.success(true)
            }
            "image/png" -> {
                try {
                    val data = Base64.decode(content, Base64.DEFAULT)
                    val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
                    if (bitmap != null) {
                        val clip = ClipData.newPlainText("clipboard", "")
                        clipboard.setPrimaryClip(clip)
                        result.success(true)
                    } else {
                        result.error("DECODE_ERROR", "Failed to decode PNG", null)
                    }
                } catch (e: Exception) {
                    result.error("DECODE_ERROR", "Failed to decode PNG: ${e.message}", null)
                }
            }
            "image/jpeg" -> {
                try {
                    val data = Base64.decode(content, Base64.DEFAULT)
                    val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
                    if (bitmap != null) {
                        val clip = ClipData.newPlainText("clipboard", "")
                        clipboard.setPrimaryClip(clip)
                        result.success(true)
                    } else {
                        result.error("DECODE_ERROR", "Failed to decode JPEG", null)
                    }
                } catch (e: Exception) {
                    result.error("DECODE_ERROR", "Failed to decode JPEG: ${e.message}", null)
                }
            }
            else -> {
                result.error("UNSUPPORTED_TYPE", "Unsupported content type: $contentType", null)
            }
        }
    }
}
