import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

const _prefsKey = 'fleet.deviceId';

/// Resolves the deviceId reported in every telemetry event.
///
/// Priority:
///  1. An explicit `--dart-define=DEVICE_ID=…` wins (pin a build to a known phone).
///  2. Otherwise a random id is generated once on first launch and persisted,
///     so one APK can be distributed and every phone reports as a distinct
///     device. The id survives app restarts; a reinstall / cleared data makes
///     a new one.
Future<String> resolveDeviceId() async {
  const override = AppConfig.configuredDeviceId;
  if (override.isNotEmpty) return override;

  final prefs = await SharedPreferences.getInstance();
  final existing = prefs.getString(_prefsKey);
  if (existing != null && existing.isNotEmpty) return existing;

  final id = _generate();
  await prefs.setString(_prefsKey, id);
  return id;
}

/// `fleet-phone-<8 hex>` from a cryptographically secure source.
String _generate() {
  final r = Random.secure();
  final hex = List<int>.generate(4, (_) => r.nextInt(256))
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join();
  return 'fleet-phone-$hex';
}
