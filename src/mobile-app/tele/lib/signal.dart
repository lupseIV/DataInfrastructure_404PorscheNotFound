import 'dart:io' show Platform;

import 'package:flutter/services.dart';

/// One raw radio-signal reading, pre-shaped for the contract's `signal_strength`
/// value `{ level, dbm?, networkType }`. No math beyond clamping the platform's
/// raw numbers into their documented ranges — the cloud does all real processing.
class SignalSample {
  final int level; // 0..4 bars
  final double? dbm; // raw RSSI/dBm when the platform exposes it
  final String networkType; // wifi | cellular | none
  final DateTime capturedAt;

  const SignalSample({
    required this.level,
    required this.dbm,
    required this.networkType,
    required this.capturedAt,
  });

  static const _networkTypes = {'wifi', 'cellular', 'none'};

  /// Parse the platform-channel map; returns null for an unusable reading.
  static SignalSample? fromPlatform(Object? raw) {
    if (raw is! Map) return null;
    final levelRaw = raw['level'];
    final type = raw['networkType'];
    if (levelRaw is! int || type is! String || !_networkTypes.contains(type)) {
      return null;
    }
    final dbmRaw = raw['dbm'];
    double? dbm;
    if (dbmRaw is num && dbmRaw.isFinite) dbm = dbmRaw.toDouble();
    return SignalSample(
      level: levelRaw.clamp(0, 4),
      dbm: dbm,
      networkType: type,
      capturedAt: DateTime.now().toUtc(),
    );
  }

  /// Contract A `signal_strength` value: `{ level, dbm?, networkType }`.
  Map<String, Object> signalValue() => {
        'level': level,
        if (dbm != null) 'dbm': dbm!,
        'networkType': networkType,
      };
}

/// Thin wrapper over the native `fleet_telemetry/signal` MethodChannel.
/// Only Android implements it; everywhere else [read] returns null so the app
/// simply omits the signal event (iOS blocks radio-signal access entirely).
class SignalReader {
  static const _channel = MethodChannel('fleet_telemetry/signal');

  Future<SignalSample?> read() async {
    if (!Platform.isAndroid) return null;
    try {
      final raw = await _channel.invokeMethod<Object?>('read');
      return SignalSample.fromPlatform(raw);
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }
}
