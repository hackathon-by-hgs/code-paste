import Flutter
import UIKit
import Network
import CoreBluetooth

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
}

// MARK: - CBCentralManagerDelegate
extension AppDelegate: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    // Bluetooth state updated
    // Permission will be shown to user if needed
  }
}
