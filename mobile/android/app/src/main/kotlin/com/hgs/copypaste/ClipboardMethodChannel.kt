package com.hgs.copypaste

import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class ClipboardMethodChannel(private val context: Context) {
    companion object {
        private const val CHANNEL_NAME = "com.hgs.copypaste/clipboard"

        fun setup(flutterEngine: FlutterEngine, context: Context) {
            val channel = MethodChannel(
                flutterEngine.dartExecutor.binaryMessenger,
                CHANNEL_NAME
            )

            val handler = ClipboardMethodChannel(context)
            channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "getClipboard" -> handler.handleGetClipboard(result)
                    "setClipboard" -> handler.handleSetClipboard(call.arguments, result)
                    else -> result.notImplemented()
                }
            }
        }
    }

    private fun handleGetClipboard(result: MethodChannel.Result) {
        val clipboardManager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clipData = clipboardManager.primaryClip

        if (clipData == null || clipData.itemCount == 0) {
            result.success(null)
            return
        }

        val item = clipData.getItemAt(0)

        // Try to get text
        val text = item.text
        if (text != null && text.isNotEmpty()) {
            result.success(
                mapOf(
                    "content" to text.toString(),
                    "contentType" to "text/plain"
                )
            )
            return
        }

        // Try to get URI (images)
        val uri = item.uri
        if (uri != null) {
            try {
                val inputStream = context.contentResolver.openInputStream(uri)
                val imageBytes = inputStream?.readBytes() ?: ByteArray(0)
                val base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP)

                // Detect image type
                val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                val contentType = if (bitmap != null) "image/png" else "image/jpeg"

                result.success(
                    mapOf(
                        "content" to base64,
                        "contentType" to contentType
                    )
                )
            } catch (e: Exception) {
                result.error("IMAGE_ERROR", "Failed to read image: ${e.message}", null)
            }
            return
        }

        result.success(null)
    }

    private fun handleSetClipboard(arguments: Any?, result: MethodChannel.Result) {
        if (arguments !is Map<*, *>) {
            result.error("INVALID_ARGS", "Invalid arguments", null)
            return
        }

        val content = arguments["content"] as? String
        val contentType = arguments["contentType"] as? String

        if (content == null || contentType == null) {
            result.error("MISSING_ARGS", "Missing content or contentType", null)
            return
        }

        val clipboardManager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

        when (contentType) {
            "text/plain" -> {
                val clip = android.content.ClipData.newPlainText("clipboard", content)
                clipboardManager.setPrimaryClip(clip)
                result.success(null)
            }

            "image/png", "image/jpeg" -> {
                try {
                    val imageBytes = Base64.decode(content, Base64.NO_WRAP)
                    val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)

                    if (bitmap != null) {
                        val clip = android.content.ClipData.newPlainText("image", "Image from clipboard")
                        clipboardManager.setPrimaryClip(clip)
                        result.success(null)
                    } else {
                        result.error("INVALID_IMAGE", "Could not decode image", null)
                    }
                } catch (e: Exception) {
                    result.error("DECODE_ERROR", "Failed to decode image: ${e.message}", null)
                }
            }

            else -> {
                result.error("UNSUPPORTED_TYPE", "Content type not supported", null)
            }
        }
    }
}
