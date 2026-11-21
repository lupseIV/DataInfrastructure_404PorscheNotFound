/// All runtime config comes from --dart-define so the API key is never
/// committed to the (public) hackathon repo.
///
/// flutter run \
///   --dart-define=INGESTION_URL=https://<your-app>.azurewebsites.net/api/telemetry \
///   --dart-define=INGESTION_API_KEY=<key> \
///   --dart-define=DEVICE_ID=fleet-phone-01
class AppConfig {
  static const ingestionUrl = String.fromEnvironment(
    'INGESTION_URL',
    defaultValue: 'http://10.0.2.2:7071/api/telemetry', // Android emulator -> host localhost
  );

  static const apiKey = String.fromEnvironment('INGESTION_API_KEY', defaultValue: 'dev-key');

  /// Optional build-time override. When empty (the default), each install
  /// generates and persists its own unique id — see [resolveDeviceId] — so a
  /// single APK can be handed out and every phone reports as a distinct device.
  /// Pass --dart-define=DEVICE_ID=fleet-phone-07 to pin a build to a known phone.
  static const configuredDeviceId = String.fromEnvironment(
    'DEVICE_ID',
    defaultValue: '',
  );

  /// How often a batch of readings is captured.
  static const sendIntervalSeconds =
      int.fromEnvironment('SEND_INTERVAL_SECONDS', defaultValue: 5);

  /// Max events per POST when flushing a backlog (offline queue).
  static const maxEventsPerRequest = 60;

  /// Max events kept in memory while offline (oldest dropped first).
  static const maxQueuedEvents = 3000;

  /// Max queued outbound requests (Contract A batches + D1/D2 events) while
  /// offline; oldest dropped first (Track 1: maxSize = 500).
  static const maxQueuedRequests = 500;

  // --- Battery status/last-call thresholds (Contracts D1/D2) -----------------
  /// Send battery-low (D1) at or below this ratio while unplugged.
  static const batteryLowThreshold = 0.20;

  /// Send battery-last-call (D2) at or below this ratio while unplugged.
  static const batteryLastCallThreshold = 0.10;

  /// Re-arm D1/D2 after charging, or after the level climbs this far above the
  /// threshold again (prevents re-sending on every tick while hovering).
  static const rearmMargin = 0.05;

  /// Base URL (stage root) derived from [ingestionUrl] by removing the
  /// `/api/telemetry` suffix, so event endpoints share the same stage.
  static String get _apiBase {
    const suffix = '/api/telemetry';
    return ingestionUrl.endsWith(suffix)
        ? ingestionUrl.substring(0, ingestionUrl.length - suffix.length)
        : ingestionUrl;
  }

  /// POST /api/events/battery-low (Contract D1).
  static String get batteryLowUrl => '$_apiBase/api/events/battery-low';

  /// POST /api/events/battery-last-call (Contract D2).
  static String get batteryLastCallUrl => '$_apiBase/api/events/battery-last-call';
}
