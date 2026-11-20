/// Contract A event: exactly 5 fields.
class TelemetryEvent {
  final String deviceId;
  final String eventType; // battery_level | charging_state | acceleration
  final Object value; // num | bool | {x,y,z}
  final String unit; // ratio | boolean | m/s2
  final String timestamp; // ISO-8601 UTC ending in Z

  const TelemetryEvent({
    required this.deviceId,
    required this.eventType,
    required this.value,
    required this.unit,
    required this.timestamp,
  });

  Map<String, Object> toJson() => {
        'deviceId': deviceId,
        'eventType': eventType,
        'value': value,
        'unit': unit,
        'timestamp': timestamp,
      };

  /// "2026-11-20T18:30:00Z" (second precision, UTC, trailing Z).
  static String utcNow() {
    final s = DateTime.now().toUtc().toIso8601String(); // 2026-11-20T18:30:00.123456Z
    return '${s.substring(0, 19)}Z';
  }

  static TelemetryEvent batteryLevel(String deviceId, double ratio, String ts) =>
      TelemetryEvent(
        deviceId: deviceId,
        eventType: 'battery_level',
        value: ratio,
        unit: 'ratio',
        timestamp: ts,
      );

  static TelemetryEvent chargingState(String deviceId, bool charging, String ts) =>
      TelemetryEvent(
        deviceId: deviceId,
        eventType: 'charging_state',
        value: charging,
        unit: 'boolean',
        timestamp: ts,
      );

  static TelemetryEvent acceleration(
          String deviceId, double x, double y, double z, String ts) =>
      TelemetryEvent(
        deviceId: deviceId,
        eventType: 'acceleration',
        value: {'x': x, 'y': y, 'z': z},
        unit: 'm/s2',
        timestamp: ts,
      );
}
