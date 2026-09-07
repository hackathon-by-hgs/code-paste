import UIKit
import Flutter

class ClipboardMethodChannel {
    static let channelName = "com.hgs.copypaste/clipboard"

    static func setup(controller: FlutterViewController) {
        let channel = FlutterMethodChannel(
            name: channelName,
            binaryMessenger: controller.binaryMessenger
        )

        channel.setMethodCallHandler { (call: FlutterMethodCall, result: @escaping FlutterResult) in
            switch call.method {
            case "getClipboard":
                handleGetClipboard(result: result)
            case "setClipboard":
                handleSetClipboard(arguments: call.arguments, result: result)
            default:
                result(FlutterMethodNotImplemented)
            }
        }
    }

    private static func handleGetClipboard(result: FlutterResult) {
        let pasteboard = UIPasteboard.general

        // Try to get text first
        if let text = pasteboard.string {
            result([
                "content": text,
                "contentType": "text/plain"
            ])
            return
        }

        // Try to get images
        if let image = pasteboard.image {
            if let pngData = image.pngData() {
                let base64 = pngData.base64EncodedString()
                result([
                    "content": base64,
                    "contentType": "image/png"
                ])
                return
            }
            if let jpegData = image.jpegData(compressionQuality: 0.9) {
                let base64 = jpegData.base64EncodedString()
                result([
                    "content": base64,
                    "contentType": "image/jpeg"
                ])
                return
            }
        }

        // Empty clipboard
        result(nil)
    }

    private static func handleSetClipboard(arguments: Any?, result: FlutterResult) {
        guard let args = arguments as? [String: Any] else {
            result(FlutterError(code: "INVALID_ARGS", message: "Invalid arguments", details: nil))
            return
        }

        guard let content = args["content"] as? String,
              let contentType = args["contentType"] as? String else {
            result(FlutterError(code: "MISSING_ARGS", message: "Missing content or contentType", details: nil))
            return
        }

        let pasteboard = UIPasteboard.general

        switch contentType {
        case "text/plain":
            pasteboard.string = content
            result(nil)

        case "image/png":
            if let imageData = Data(base64Encoded: content),
               let image = UIImage(data: imageData) {
                pasteboard.image = image
                result(nil)
            } else {
                result(FlutterError(code: "INVALID_IMAGE", message: "Could not decode image", details: nil))
            }

        case "image/jpeg":
            if let imageData = Data(base64Encoded: content),
               let image = UIImage(data: imageData) {
                pasteboard.image = image
                result(nil)
            } else {
                result(FlutterError(code: "INVALID_IMAGE", message: "Could not decode image", details: nil))
            }

        default:
            result(FlutterError(code: "UNSUPPORTED_TYPE", message: "Content type not supported", details: nil))
        }
    }
}
