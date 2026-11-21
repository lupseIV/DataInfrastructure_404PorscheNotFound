import 'dart:async';
import 'dart:convert';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:sensors_plus/sensors_plus.dart';

import 'config.dart';
import 'geo.dart';
import 'telemetry_event.dart';

enum SendStatus { idle, sending, ok, retrying, rejected, unauthorized }

/// One queued outbound HTTP POST: a Contract A batch (array body) or a
/// D1/D2 event (object body). Both share the offline queue and retry logic.
class _Outbound {
  final String url;
  final Object body; // List<Map> for batches, Map for events -> jsonEncode
  const _Outbound(this.url, this.body);
}

/// Reads battery + accelerometer + GPS, builds Contract A batches (now including
/// `location` and `motion_heading`) and the Contract D1/D2 battery events, and
/// POSTs them. Failed requests stay queued and are retried with backoff;
/// last-call (D2) events jump to the front of the queue. 400/401 are not retried.
class TelemetryService extends ChangeNotifier with WidgetsBindingObserver {
  final _battery = Battery();
  final _client = http.Client();

  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<BatteryState>? _batterySub;
  StreamSubscription<Position>? _posSub;
  Timer? _captureTimer;
  Timer? _retryTimer;

  /// Id stamped on every event. Defaults to the build-time override (if any);
  /// the UI sets this to the resolved per-install id before calling [start].
  String deviceId = AppConfig.configuredDeviceId;

  // Latest raw readings (shown in UI).
  AccelerometerEvent? lastAccel;
  double? lastBatteryRatio;
  bool? lastCharging;
  GeoSample? lastGeo;

  // Device context sent with D1/D2 events.
  bool _powerSave = false;
  String _appState = 'foreground';

  // D1/D2 re-arm flags (hysteresis): true = allowed to fire.
  bool _lowArmed = true;
  bool _lastCallArmed = true;

  // Status (shown in UI).
  bool running = false;
  SendStatus status = SendStatus.idle;
  String lastMessage = '—';
  DateTime? lastSuccessAt;
  int totalAccepted = 0;
  int retryAttempt = 0;

  final List<_Outbound> _queue = [];
  bool _inFlight = false;

  int get queued => _queue.length;

  void start() {
    if (running) return;
    running = true;
    WidgetsBinding.instance.addObserver(this);

    // Raw accelerometer INCLUDING gravity (= accelerationIncludingGravity on web).
    _accelSub = accelerometerEventStream(samplingPeriod: SensorInterval.uiInterval)
        .listen((e) => lastAccel = e, onError: (_) {});

    // Charging changes are sent immediately, not only on the timer.
    _batterySub = _battery.onBatteryStateChanged.listen((s) {
      final c = _isCharging(s);
      if (lastCharging != null && c != lastCharging) _capture();
    });

    _startLocation();

    _capture();
    _captureTimer = Timer.periodic(
      const Duration(seconds: AppConfig.sendIntervalSeconds),
      (_) => _capture(),
    );
    notifyListeners();
  }

  void stop() {
    running = false;
    WidgetsBinding.instance.removeObserver(this);
    _accelSub?.cancel();
    _batterySub?.cancel();
    _posSub?.cancel();
    _captureTimer?.cancel();
    _retryTimer?.cancel();
    _accelSub = null;
    _batterySub = null;
    _posSub = null;
    status = SendStatus.idle;
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appState = state == AppLifecycleState.resumed ? 'foreground' : 'background';
  }

  /// Ask for location permission and keep the latest raw fix cached.
  Future<void> _startLocation() async {
    try {
      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        debugPrint('location permission not granted: $perm');
        return;
      }
      _posSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 0,
        ),
      ).listen((p) => lastGeo = GeoSample.fromPosition(p), onError: (_) {});
    } catch (e) {
      debugPrint('location unavailable: $e');
    }
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

    try {
      _powerSave = await _battery.isInBatterySaveMode;
    } catch (e) {
      debugPrint('power save mode unavailable: $e');
    }

    final a = lastAccel;
    if (a != null) {
      events.add(TelemetryEvent.acceleration(id, a.x, a.y, a.z, ts));
    }

    // Contract A additions: location + motion_heading (every cycle, when a fix exists).
    final geo = lastGeo;
    if (geo != null) {
      events.add(TelemetryEvent.location(id, geo.locationValue(), ts));
      events.add(TelemetryEvent.motionHeading(id, geo.headingValue(), ts));
    }

    if (events.isNotEmpty) {
      _push(_Outbound(
        AppConfig.ingestionUrl,
        events.map((e) => e.toJson()).toList(),
      ));
    }

    // Contracts D1/D2: fire battery status / last-call events on threshold crossings.
    if (lastBatteryRatio != null && lastCharging != null) {
      _evaluateBattery(lastBatteryRatio!, lastCharging!, ts);
    }

    notifyListeners();
    _flush();
  }

  /// D1 (battery-low) at <= 0.20 unplugged; D2 (battery-last-call) at <= 0.10.
  /// Each fires once, re-arming after charging or climbing [rearmMargin] above
  /// the threshold. The only on-device logic is "raw value vs. constant".
  void _evaluateBattery(double r, bool charging, String ts) {
    // Re-arm first, so we never fire and re-arm in the same tick.
    if (charging || r >= AppConfig.batteryLowThreshold + AppConfig.rearmMargin) {
      _lowArmed = true;
    }
    if (charging ||
        r >= AppConfig.batteryLastCallThreshold + AppConfig.rearmMargin) {
      _lastCallArmed = true;
    }

    if (_lastCallArmed && !charging && r <= AppConfig.batteryLastCallThreshold) {
      _lastCallArmed = false;
      _lowArmed = false; // last-call supersedes the low status on this descent
      _push(
        _Outbound(AppConfig.batteryLastCallUrl,
            _batteryEventBody(r: r, charging: charging, ts: ts, lastCall: true)),
        front: true, // jump the queue: best last-known state before the phone dies
      );
    } else if (_lowArmed && !charging && r <= AppConfig.batteryLowThreshold) {
      _lowArmed = false;
      _push(_Outbound(AppConfig.batteryLowUrl,
          _batteryEventBody(r: r, charging: charging, ts: ts, lastCall: false)));
    }
  }

  Map<String, Object?> _batteryEventBody({
    required double r,
    required bool charging,
    required String ts,
    required bool lastCall,
  }) {
    final geo = lastGeo;
    final body = <String, Object?>{
      'deviceId': deviceId,
      'timestamp': ts,
      'batteryLevel': r,
      'isCharging': charging,
      'powerSaveMode': _powerSave,
      'appState': _appState,
      'schemaVersion': TelemetryEvent.schemaVersion,
      'location': geo?.locationWithCapturedAt(),
      'heading': geo?.headingValue(),
    };
    if (lastCall) {
      // Required on D2: position/heading at the moment of the call.
      body['lastKnownLocation'] = geo?.locationWithCapturedAt();
      body['pendingEventCount'] = _queue.length;
    } else if (geo == null) {
      // D1 with no current fix: supply lastKnownLocation (null if never seen).
      body['lastKnownLocation'] = null;
    }
    return body;
  }

  /// Enqueue an outbound request; [front] for last-call priority. Caps the
  /// queue at [maxQueuedRequests], dropping the oldest on overflow.
  void _push(_Outbound req, {bool front = false}) {
    if (front) {
      _queue.insert(0, req);
    } else {
      _queue.add(req);
    }
    final overflow = _queue.length - AppConfig.maxQueuedRequests;
    if (overflow > 0) _queue.removeRange(0, overflow);
  }

  Future<void> _flush() async {
    if (_inFlight || _queue.isEmpty) return;
    _inFlight = true;
    _retryTimer?.cancel();

    final req = _queue.first;
    status = SendStatus.sending;
    notifyListeners();

    try {
      final res = await _client
          .post(
            Uri.parse(req.url),
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': AppConfig.apiKey,
            },
            body: jsonEncode(req.body),
          )
          .timeout(const Duration(seconds: 10));

      if (res.statusCode == 202 || res.statusCode == 200) {
        _queue.removeAt(0);
        retryAttempt = 0;
        status = SendStatus.ok;
        lastSuccessAt = DateTime.now();
        int accepted = req.body is List ? (req.body as List).length : 1;
        try {
          accepted = (jsonDecode(res.body)['accepted'] as num).toInt();
        } catch (_) {}
        totalAccepted += accepted;
        lastMessage = '${res.statusCode} accepted=$accepted';
      } else if (res.statusCode == 400) {
        // Bad data will never succeed: drop it so it doesn't block the queue.
        _queue.removeAt(0);
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
