import 'dart:async';
import 'dart:convert';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:sensors_plus/sensors_plus.dart';

import 'config.dart';
import 'telemetry_event.dart';

enum SendStatus { idle, sending, ok, retrying, rejected, unauthorized }

/// Reads battery + accelerometer, builds Contract A batches and POSTs them.
/// Failed batches (network / 5xx) stay queued and are retried with backoff.
/// 400 / 401 are not retried (they won't succeed by repeating).
class TelemetryService extends ChangeNotifier {
  final _battery = Battery();
  final _client = http.Client();

  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<BatteryState>? _batterySub;
  Timer? _captureTimer;
  Timer? _retryTimer;

  // Latest raw readings (shown in UI).
  AccelerometerEvent? lastAccel;
  double? lastBatteryRatio;
  bool? lastCharging;

  /// Id stamped on every event. Defaults to the build-time override (if any);
  /// the UI sets this to the resolved per-install id before calling [start].
  String deviceId = AppConfig.configuredDeviceId;

  // Status (shown in UI).
  bool running = false;
  SendStatus status = SendStatus.idle;
  String lastMessage = '—';
  DateTime? lastSuccessAt;
  int totalAccepted = 0;
  int retryAttempt = 0;

  final List<TelemetryEvent> _queue = [];
  bool _inFlight = false;

  int get queued => _queue.length;

  void start() {
    if (running) return;
    running = true;

    // Raw accelerometer INCLUDING gravity (= accelerationIncludingGravity on web).
    _accelSub = accelerometerEventStream(samplingPeriod: SensorInterval.uiInterval)
        .listen((e) => lastAccel = e, onError: (_) {});

    // Charging changes are sent immediately, not only on the timer.
    _batterySub = _battery.onBatteryStateChanged.listen((s) {
      final c = _isCharging(s);
      if (lastCharging != null && c != lastCharging) _capture();
    });

    _capture();
    _captureTimer = Timer.periodic(
      const Duration(seconds: AppConfig.sendIntervalSeconds),
      (_) => _capture(),
    );
    notifyListeners();
  }

  void stop() {
    running = false;
    _accelSub?.cancel();
    _batterySub?.cancel();
    _captureTimer?.cancel();
    _retryTimer?.cancel();
    _accelSub = null;
    _batterySub = null;
    status = SendStatus.idle;
    notifyListeners();
  }

  /// plugged in (charging / full / connected-not-charging) => true,
  /// matching the browser's battery.charging semantics.
  static bool _isCharging(BatteryState s) =>
      s == BatteryState.charging ||
      s == BatteryState.full ||
      s == BatteryState.connectedNotCharging;

  Future<void> _capture() async {
    final ts = TelemetryEvent.utcNow();
    final id = deviceId;
    final events = <TelemetryEvent>[];

    try {
      // battery_plus gives an int percentage (0-100); the contract wants a 0.0-1.0 ratio.
      final pct = await _battery.batteryLevel;
      lastBatteryRatio = pct / 100.0;
      events.add(TelemetryEvent.batteryLevel(id, lastBatteryRatio!, ts));
    } catch (e) {
      debugPrint('battery level unavailable: $e');
    }

    try {
      lastCharging = _isCharging(await _battery.batteryState);
      events.add(TelemetryEvent.chargingState(id, lastCharging!, ts));
    } catch (e) {
      debugPrint('charging state unavailable: $e');
    }

    final a = lastAccel;
    if (a != null) {
      events.add(TelemetryEvent.acceleration(id, a.x, a.y, a.z, ts));
    }

    if (events.isEmpty) return;
    _enqueue(events);
    notifyListeners();
    _flush();
  }

  void _enqueue(List<TelemetryEvent> events) {
    _queue.addAll(events);
    final overflow = _queue.length - AppConfig.maxQueuedEvents;
    if (overflow > 0) _queue.removeRange(0, overflow);
  }

  Future<void> _flush() async {
    if (_inFlight || _queue.isEmpty) return;
    _inFlight = true;
    _retryTimer?.cancel();

    final batch = _queue.take(AppConfig.maxEventsPerRequest).toList();
    status = SendStatus.sending;
    notifyListeners();

    try {
      final res = await _client
          .post(
            Uri.parse(AppConfig.ingestionUrl),
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': AppConfig.apiKey,
            },
            body: jsonEncode(batch.map((e) => e.toJson()).toList()),
          )
          .timeout(const Duration(seconds: 10));

      if (res.statusCode == 202 || res.statusCode == 200) {
        _queue.removeRange(0, batch.length);
        retryAttempt = 0;
        status = SendStatus.ok;
        lastSuccessAt = DateTime.now();
        int accepted = batch.length;
        try {
          accepted = (jsonDecode(res.body)['accepted'] as num).toInt();
        } catch (_) {}
        totalAccepted += accepted;
        lastMessage = '${res.statusCode} accepted=$accepted';
      } else if (res.statusCode == 400) {
        // Bad data will never succeed: drop it so it doesn't block the queue.
        _queue.removeRange(0, batch.length);
        status = SendStatus.rejected;
        lastMessage = '400 ${res.body}';
      } else if (res.statusCode == 401) {
        // Wrong key: keep data, stop hammering; next capture tick will try again.
        status = SendStatus.unauthorized;
        lastMessage = '401 ${res.body}';
      } else {
        _scheduleRetry('HTTP ${res.statusCode}');
      }
    } catch (e) {
      _scheduleRetry(e.toString());
    } finally {
      _inFlight = false;
      notifyListeners();
    }

    // Drain backlog if we just recovered.
    if (status == SendStatus.ok && _queue.isNotEmpty) _flush();
  }

  /// Exponential backoff: 1, 2, 4, 8, 16, 30, 30... seconds.
  void _scheduleRetry(String reason) {
    retryAttempt++;
    final int secs = retryAttempt >= 6 ? 30 : 1 << (retryAttempt - 1);
    status = SendStatus.retrying;
    lastMessage = 'retry #$retryAttempt in ${secs}s ($reason)';
    if (running) {
      _retryTimer = Timer(Duration(seconds: secs), _flush);
    }
  }

  @override
  void dispose() {
    stop();
    _client.close();
    super.dispose();
  }
}
