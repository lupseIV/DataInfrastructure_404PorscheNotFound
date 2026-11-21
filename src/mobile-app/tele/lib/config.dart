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

  /// How often a batch of 3 readings is captured.
  static const sendIntervalSeconds =
      int.fromEnvironment('SEND_INTERVAL_SECONDS', defaultValue: 5);

  /// Max events per POST when flushing a backlog (offline queue).
  static const maxEventsPerRequest = 60;

  /// Max events kept in memory while offline (oldest dropped first).
  static const maxQueuedEvents = 3000;
}
