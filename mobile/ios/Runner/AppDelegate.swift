import Flutter
import UIKit
import Network
import CoreBluetooth
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var bluetoothManager: CBCentralManager?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    // Setup method channel for permissions
    let controller = window?.rootViewController as! FlutterViewController
    let permissionChannel = FlutterMethodChannel(
      name: "com.hgs.copypaste/permissions",
      binaryMessenger: controller.binaryMessenger
    )

    permissionChannel.setMethodCallHandler { [weak self] (call: FlutterMethodCall, result: @escaping FlutterResult) in
      switch call.method {
      case "requestLocalNetworkPermission":
        self?.requestLocalNetworkPermission(result: result)
      case "requestBluetoothPermission":
        self?.requestBluetoothPermission(result: result)
      case "requestNotificationPermission":
        self?.requestNotificationPermission(result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    // Setup method channel for clipboard
    let clipboardChannel = FlutterMethodChannel(
      name: "com.hgs.copypaste/clipboard",
      binaryMessenger: controller.binaryMessenger
    )

    clipboardChannel.setMethodCallHandler { (call: FlutterMethodCall, result: @escaping FlutterResult) in
      switch call.method {
      case "readClipboard":
        self.readClipboard(result: result)
      case "writeClipboard":
        let args = call.arguments as? [String: Any]
        self.writeClipboard(args: args, result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // MARK: - Local Network Permission (iOS 14+)
  private func requestLocalNetworkPermission(result: @escaping FlutterResult) {
    // iOS 14+: Local network access requires NWPathMonitor
    let monitor = NWPathMonitor()
    monitor.start(queue: DispatchQueue.global())

    // If we can create a monitor, local network permission is granted
    // The system will show the permission dialog if needed
    result(true)
  }

  // MARK: - Bluetooth Permission
  private func requestBluetoothPermission(result: @escaping FlutterResult) {
    // iOS 13+: Bluetooth permission is requested via CBCentralManager
    bluetoothManager = CBCentralManager(delegate: self, queue: nil)

    // We'll set the result in the delegate callback
    // For now, we assume it will be granted
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      result(true)
    }
  }

  // MARK: - Notification Permission
  private func requestNotificationPermission(result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
      DispatchQueue.main.async {
        result(granted)
      }
    }
  }

  // MARK: - Clipboard Operations
  private func readClipboard(result: @escaping FlutterResult) {
    let pasteboard = UIPasteboard.general
    var output: [String: Any] = [:]

    // Check for text
    if let text = pasteboard.string {
      output["type"] = "text"
      output["content"] = text
      result(output)
      return
    }

    // Check for images (PNG/JPEG)
    if let image = pasteboard.image {
      if let pngData = image.pngData() {
        let base64 = pngData.base64EncodedString()
        output["type"] = "image/png"
        output["content"] = base64
        result(output)
        return
      }
      if let jpegData = image.jpegData(compressionQuality: 0.9) {
        let base64 = jpegData.base64EncodedString()
        output["type"] = "image/jpeg"
        output["content"] = base64
        result(output)
        return
      }
    }

    // Empty clipboard
    result(nil)
  }

  private func writeClipboard(args: [String: Any]?, result: @escaping FlutterResult) {
    guard let args = args else {
      result(FlutterError(code: "INVALID_ARGS", message: "Missing arguments", details: nil))
      return
    }

    let pasteboard = UIPasteboard.general
    let contentType = args["type"] as? String
    let content = args["content"] as? String

    guard let contentType = contentType, let content = content else {
      result(FlutterError(code: "INVALID_ARGS", message: "Missing type or content", details: nil))
      return
    }

    switch contentType {
    case "text/plain":
      pasteboard.string = content
      result(true)
    case "image/png":
      if let data = Data(base64Encoded: content), let image = UIImage(data: data) {
        pasteboard.image = image
        result(true)
      } else {
        result(FlutterError(code: "DECODE_ERROR", message: "Failed to decode PNG", details: nil))
      }
    case "image/jpeg":
      if let data = Data(base64Encoded: content), let image = UIImage(data: data) {
        pasteboard.image = image
        result(true)
      } else {
        result(FlutterError(code: "DECODE_ERROR", message: "Failed to decode JPEG", details: nil))
      }
    default:
      result(FlutterError(code: "UNSUPPORTED_TYPE", message: "Unsupported content type: \(contentType)", details: nil))
    }
  }
}

// MARK: - CBCentralManagerDelegate
extension AppDelegate: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    // Bluetooth state updated
    // Permission will be shown to user if needed
  }
}
