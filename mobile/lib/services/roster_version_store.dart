import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Remembers the highest `rosterVersion` this device has accepted.
///
/// `rosterVersion` is a monotonic per-device counter, so a roster carrying a
/// lower value than one already seen is a replay of a stale authorization set —
/// typically an attempt to reinstate a peer that has since been revoked.
/// Detecting that requires state that survives a restart, which is the only
/// reason this store exists.
abstract class RosterVersionStore {
  /// Highest version accepted so far for [deviceId], or null if none yet.
  Future<int?> highWaterMark(String deviceId);

  /// Records [rosterVersion] as accepted. Never lowers an existing mark.
  Future<void> record(String deviceId, int rosterVersion);
}

class SecureRosterVersionStore implements RosterVersionStore {
  static const String _keyPrefix = 'roster_version_';

  final FlutterSecureStorage _storage;

  SecureRosterVersionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  String _key(String deviceId) => '$_keyPrefix$deviceId';

  @override
  Future<int?> highWaterMark(String deviceId) async {
    final raw = await _storage.read(key: _key(deviceId));
    if (raw == null) return null;
    // A corrupt or hand-edited value must not read as "no mark", which would
    // silently disable rollback detection. Treat it as the most restrictive
    // value we can still parse nothing from: unknown, but loudly so.
    return int.tryParse(raw);
  }

  @override
  Future<void> record(String deviceId, int rosterVersion) async {
    final current = await highWaterMark(deviceId);
    if (current != null && current >= rosterVersion) return;
    await _storage.write(key: _key(deviceId), value: rosterVersion.toString());
  }
}

/// Non-persistent store for tests.
class InMemoryRosterVersionStore implements RosterVersionStore {
  final Map<String, int> _marks = <String, int>{};

  @override
  Future<int?> highWaterMark(String deviceId) async => _marks[deviceId];

  @override
  Future<void> record(String deviceId, int rosterVersion) async {
    final current = _marks[deviceId];
    if (current != null && current >= rosterVersion) return;
    _marks[deviceId] = rosterVersion;
  }
}
