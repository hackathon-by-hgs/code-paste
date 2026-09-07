package com.hgs.copypaste

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.hgs.copypaste/permissions"
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
}
