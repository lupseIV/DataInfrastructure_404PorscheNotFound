import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'device_identity.dart';
import 'telemetry_service.dart';

void main() => runApp(const FleetTelemetryApp());

/// ---------------------------------------------------------------------------
/// Palette — "Liquid Glass" colours derived from the active brightness.
/// Text/glass tones come from here; the vivid backdrop lives in [_LiquidBackground].
/// ---------------------------------------------------------------------------
class _Palette {
  const _Palette(this.dark);
  final bool dark;

  factory _Palette.of(BuildContext c) =>
      _Palette(Theme.of(c).brightness == Brightness.dark);

  Color get text => dark ? Colors.white : const Color(0xFF17182A);
  Color get subtext =>
      dark ? Colors.white.withValues(alpha: 0.64) : const Color(0xFF5B5E74);

  Color get glass => dark
      ? Colors.white.withValues(alpha: 0.09)
      : Colors.white.withValues(alpha: 0.52);
  Color get glassStrong => dark
      ? Colors.white.withValues(alpha: 0.16)
      : Colors.white.withValues(alpha: 0.66);
  // Near-opaque "glass-look" fills for tiles that skip the real backdrop blur
  // (keeps the look but avoids an expensive BackdropFilter per card).
  Color get glassSolid => dark
      ? const Color(0xFF1C1E2C).withValues(alpha: 0.82)
      : Colors.white.withValues(alpha: 0.86);
  Color get glassSolidStrong => dark
      ? const Color(0xFF24263A).withValues(alpha: 0.90)
      : Colors.white.withValues(alpha: 0.92);
  Color get border => dark
      ? Colors.white.withValues(alpha: 0.18)
      : Colors.white.withValues(alpha: 0.75);
  Color get track => dark
      ? Colors.white.withValues(alpha: 0.16)
      : Colors.black.withValues(alpha: 0.06);

  // Status accents (read well on glass in both modes).
  static const ok = Color(0xFF30D158); // iOS green
  static const info = Color(0xFF0A84FF); // iOS blue
  static const warn = Color(0xFFFF9F0A); // iOS orange
  static const danger = Color(0xFFFF453A); // iOS red
}

const _radius = 26.0;

class FleetTelemetryApp extends StatelessWidget {
  const FleetTelemetryApp({super.key});

  ThemeData _theme(Brightness b) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF5B6CFF),
      brightness: b,
    );
    // No fontFamily override → SF Pro on iOS, Roboto on Android (native feel).
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor:
          b == Brightness.dark ? const Color(0xFF07070E) : const Color(0xFFEAF0FF),
    );
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Fleet Telemetry',
        debugShowCheckedModeBanner: false,
        theme: _theme(Brightness.light),
        darkTheme: _theme(Brightness.dark),
        themeMode: ThemeMode.system,
        home: const TelemetryScreen(),
      );
}

/// ---------------------------------------------------------------------------
/// Screen
/// ---------------------------------------------------------------------------
class TelemetryScreen extends StatefulWidget {
  const TelemetryScreen({super.key});

  @override
  State<TelemetryScreen> createState() => _TelemetryScreenState();
}

class _TelemetryScreenState extends State<TelemetryScreen>
    with SingleTickerProviderStateMixin {
  final svc = TelemetryService();
  late final AnimationController _pulse;
  String _deviceId = '';

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _init();
  }

  /// Resolve the per-install device id first, then start streaming so the very
  /// first batch already carries the correct id.
  Future<void> _init() async {
    final id = await resolveDeviceId();
    svc.deviceId = id;
    if (mounted) setState(() => _deviceId = id);
    svc.start();
  }

  @override
  void dispose() {
    _pulse.dispose();
    svc.dispose();
    super.dispose();
  }

  _StatusLook _look(SendStatus s) => switch (s) {
        SendStatus.ok => const _StatusLook(_Palette.ok, Icons.check_circle_rounded,
            'Connected', 'Streaming telemetry to the fleet endpoint'),
        SendStatus.sending => const _StatusLook(_Palette.info, Icons.sync_rounded,
            'Sending', 'Uploading the latest batch'),
        SendStatus.retrying => const _StatusLook(_Palette.warn,
            Icons.history_rounded, 'Retrying', 'Connection hiccup — backing off'),
        SendStatus.rejected => const _StatusLook(_Palette.danger,
            Icons.error_rounded, 'Rejected', 'The server refused the payload'),
        SendStatus.unauthorized => const _StatusLook(_Palette.danger,
            Icons.lock_rounded, 'Unauthorized', 'Check the API key'),
        SendStatus.idle => const _StatusLook(Color(0xFF9AA0B4),
            Icons.pause_circle_rounded, 'Paused', 'Telemetry capture is stopped'),
      };

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return Scaffold(
      extendBody: true,
      body: Stack(
        children: [
          const Positioned.fill(child: _LiquidBackground()),
          SafeArea(
            bottom: false,
            child: ListenableBuilder(
              listenable: svc,
              builder: (context, _) {
                final look = _look(svc.status);
                final a = svc.lastAccel;
                return Column(
                  children: [
                    _Header(
                      deviceId: _deviceId.isEmpty ? 'identifying…' : _deviceId,
                      running: svc.running,
                    ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 110),
                        child: Column(
                          children: [
                          _StatusHero(
                            look: look,
                            running: svc.running,
                            pulse: _pulse,
                            lastSuccess: svc.lastSuccessAt,
                            detail: svc.lastMessage,
                          ),
                          const SizedBox(height: 18),
                          const _SectionLabel('Live readings'),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: _BatteryTile(
                                  ratio: svc.lastBatteryRatio,
                                  charging: svc.lastCharging,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: _ChargingTile(charging: svc.lastCharging),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          _AccelCard(accel: a),
                          const SizedBox(height: 18),
                          const _SectionLabel('Transmission'),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: _StatTile(
                                  icon: Icons.cloud_done_rounded,
                                  label: 'Events sent',
                                  value: _compact(svc.totalAccepted),
                                  tint: _Palette.ok,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: _StatTile(
                                  icon: Icons.inbox_rounded,
                                  label: 'Queued offline',
                                  value: _compact(svc.queued),
                                  tint: svc.queued > 0 ? _Palette.warn : p.subtext,
                                ),
                              ),
                            ],
                          ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: ListenableBuilder(
              listenable: svc,
              builder: (context, _) => _ActionBar(
                running: svc.running,
                onPressed: () => svc.running ? svc.stop() : svc.start(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _compact(int n) {
    if (n < 1000) return '$n';
    if (n < 1000000) return '${(n / 1000).toStringAsFixed(n < 10000 ? 1 : 0)}k';
    return '${(n / 1000000).toStringAsFixed(1)}M';
  }
}

/// ---------------------------------------------------------------------------
/// Vivid, soft backdrop so the frosted glass has something to refract.
/// ---------------------------------------------------------------------------
class _LiquidBackground extends StatelessWidget {
  const _LiquidBackground();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? const [Color(0xFF0A0A14), Color(0xFF130E24), Color(0xFF0C1322)]
              : const [Color(0xFFE9EEFF), Color(0xFFF3ECFF), Color(0xFFFFF0F6)],
        ),
      ),
      child: Stack(
        children: [
          _blob(const Alignment(-1.1, -1.0), 360,
              const Color(0xFF6C5CFF), dark ? 0.40 : 0.55),
          _blob(const Alignment(1.2, -0.5), 320,
              const Color(0xFF00C2FF), dark ? 0.30 : 0.42),
          _blob(const Alignment(-0.9, 1.1), 380,
              const Color(0xFFFF6FB5), dark ? 0.28 : 0.42),
          _blob(const Alignment(1.1, 1.2), 340,
              const Color(0xFF8B5CF6), dark ? 0.32 : 0.40),
        ],
      ),
    );
  }

  Widget _blob(Alignment align, double size, Color color, double alpha) =>
      Align(
        alignment: align,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(
              colors: [color.withValues(alpha: alpha), color.withValues(alpha: 0)],
            ),
          ),
        ),
      );
}

/// ---------------------------------------------------------------------------
/// The core Liquid-Glass surface: real backdrop blur + bright edge + highlight.
/// ---------------------------------------------------------------------------
class _Glass extends StatelessWidget {
  const _Glass({
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.radius = _radius,
    this.tint,
    this.strong = false,
    this.blur = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color? tint;
  final bool strong;

  /// When true, render a real `BackdropFilter` (expensive). Small tiles leave
  /// this false and use a near-opaque fill that looks the same but rasterises
  /// far cheaper — only the big hero + action bar pay for live blur.
  final bool blur;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    final shape = BorderRadius.circular(radius);
    // The surface contents (fill + sheen + tint + child) are identical whether
    // or not we blur; only big surfaces wrap this in a live BackdropFilter.
    final surface = Container(
      decoration: BoxDecoration(
        color: blur
            ? (strong ? p.glassStrong : p.glass)
            : (strong ? p.glassSolidStrong : p.glassSolid),
        borderRadius: shape,
        border: Border.all(color: p.border, width: 1),
      ),
      child: Stack(
        children: [
          // Top-left sheen — the signature liquid-glass highlight.
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: shape,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Colors.white.withValues(alpha: p.dark ? 0.14 : 0.40),
                      Colors.white.withValues(alpha: 0.0),
                    ],
                    stops: const [0.0, 0.55],
                  ),
                ),
              ),
            ),
          ),
          // Optional status colour wash.
          if (tint != null)
            Positioned.fill(
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: shape,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        tint!.withValues(alpha: 0.26),
                        tint!.withValues(alpha: 0.05),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          Padding(padding: padding, child: child),
        ],
      ),
    );

    // RepaintBoundary isolates each card so a sibling's repaint (e.g. the
    // ticking accel bars) doesn't re-rasterise this whole surface.
    return RepaintBoundary(
      child: DecoratedBox(
        // Soft outer shadow to lift the glass off the backdrop.
        decoration: BoxDecoration(
          borderRadius: shape,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: p.dark ? 0.35 : 0.10),
              blurRadius: 24,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: shape,
          child: blur
              ? BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                  child: surface,
                )
              : surface,
        ),
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// Header
/// ---------------------------------------------------------------------------
class _Header extends StatelessWidget {
  const _Header({required this.deviceId, required this.running});

  final String deviceId;
  final bool running;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 16, 12),
      child: Row(
        children: [
          Container(
            height: 44,
            width: 44,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF6C5CFF), Color(0xFF9B5CFF)],
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF6C5CFF).withValues(alpha: 0.45),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(Icons.sensors_rounded, color: Colors.white),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Fleet Telemetry',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: p.text,
                    letterSpacing: -0.3,
                  ),
                ),
                GestureDetector(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: deviceId));
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Device ID copied · $deviceId'),
                        duration: const Duration(milliseconds: 1400),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          deviceId,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: p.subtext,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Icon(Icons.copy_rounded, size: 12, color: p.subtext),
                    ],
                  ),
                ),
              ],
            ),
          ),
          _LivePill(running: running),
        ],
      ),
    );
  }
}

class _LivePill extends StatelessWidget {
  const _LivePill({required this.running});
  final bool running;

  @override
  Widget build(BuildContext context) {
    final color = running ? _Palette.ok : const Color(0xFF9AA0B4);
    return _Glass(
      radius: 999,
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
      strong: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            height: 8,
            width: 8,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(color: color.withValues(alpha: 0.8), blurRadius: 7),
              ],
            ),
          ),
          const SizedBox(width: 7),
          Text(
            running ? 'LIVE' : 'OFF',
            style: TextStyle(
              color: _Palette.of(context).text,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// Status hero
/// ---------------------------------------------------------------------------
class _StatusLook {
  const _StatusLook(this.color, this.icon, this.title, this.subtitle);
  final Color color;
  final IconData icon;
  final String title;
  final String subtitle;
}

class _StatusHero extends StatelessWidget {
  const _StatusHero({
    required this.look,
    required this.running,
    required this.pulse,
    required this.lastSuccess,
    required this.detail,
  });

  final _StatusLook look;
  final bool running;
  final AnimationController pulse;
  final DateTime? lastSuccess;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return _Glass(
      tint: look.color,
      strong: true,
      blur: true, // the hero is the one surface that keeps live backdrop blur
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _PulseDot(
                color: look.color,
                icon: look.icon,
                animate: running,
                controller: pulse,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      look.title,
                      style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                        color: p.text,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      look.subtitle,
                      style: TextStyle(fontSize: 13.5, color: p.subtext),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: _HeroFact(
                    label: 'Last success', value: _timeAgo(lastSuccess)),
              ),
              Container(width: 1, height: 30, color: p.track),
              Expanded(
                child: _HeroFact(
                  label: 'Server',
                  value: detail == '—' ? 'Waiting…' : detail,
                  mono: true,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _timeAgo(DateTime? t) {
    if (t == null) return '—';
    final d = DateTime.now().difference(t);
    if (d.inSeconds < 5) return 'just now';
    if (d.inSeconds < 60) return '${d.inSeconds}s ago';
    if (d.inMinutes < 60) return '${d.inMinutes}m ago';
    return '${d.inHours}h ago';
  }
}

class _HeroFact extends StatelessWidget {
  const _HeroFact({required this.label, required this.value, this.mono = false});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: p.subtext,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: p.text,
              fontFamily: mono ? 'monospace' : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _PulseDot extends StatelessWidget {
  const _PulseDot({
    required this.color,
    required this.icon,
    required this.animate,
    required this.controller,
  });

  final Color color;
  final IconData icon;
  final bool animate;
  final AnimationController controller;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 54,
      width: 54,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (animate)
            // Own layer so the 60fps pulse repaints only itself — without this
            // every frame invalidates the hero's BackdropFilter above it and
            // re-blurs the whole backdrop.
            RepaintBoundary(
              child: AnimatedBuilder(
                animation: controller,
                builder: (context, child) {
                  final t = controller.value;
                  return Container(
                    height: 38 + 16 * t,
                    width: 38 + 16 * t,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.22 * (1 - t)),
                    ),
                  );
                },
              ),
            ),
          Container(
            height: 46,
            width: 46,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color.withValues(alpha: 0.20),
              border: Border.all(color: color.withValues(alpha: 0.5)),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
        ],
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// Live-reading tiles
/// ---------------------------------------------------------------------------
class _BatteryTile extends StatelessWidget {
  const _BatteryTile({required this.ratio, required this.charging});

  final double? ratio;
  final bool? charging;

  Color _color() {
    final r = ratio;
    if (r == null) return const Color(0xFF9AA0B4);
    if (r <= 0.15) return _Palette.danger;
    if (r <= 0.35) return _Palette.warn;
    return _Palette.ok;
  }

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    final r = ratio;
    final pct = r == null ? '—' : '${(r * 100).round()}';
    final color = _color();
    return _Glass(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                height: 54,
                width: 54,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      height: 54,
                      width: 54,
                      child: CircularProgressIndicator(
                        value: r ?? 0,
                        strokeWidth: 6,
                        strokeCap: StrokeCap.round,
                        backgroundColor: p.track,
                        valueColor: AlwaysStoppedAnimation(color),
                      ),
                    ),
                    Icon(
                      (charging ?? false)
                          ? Icons.bolt_rounded
                          : Icons.battery_full_rounded,
                      size: 20,
                      color: color,
                    ),
                  ],
                ),
              ),
              const Spacer(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    pct,
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                      height: 1,
                      color: p.text,
                      letterSpacing: -0.5,
                    ),
                  ),
                  Text(
                    '%',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: p.subtext,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Battery',
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w600, color: p.subtext),
          ),
        ],
      ),
    );
  }
}

class _ChargingTile extends StatelessWidget {
  const _ChargingTile({required this.charging});
  final bool? charging;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    final c = charging;
    final on = c == true;
    final color = on ? _Palette.ok : p.subtext;
    final label = c == null
        ? '—'
        : on
            ? 'Plugged in'
            : 'On battery';
    return _Glass(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 54,
            width: 54,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: color.withValues(alpha: 0.4)),
            ),
            child: Icon(
              on ? Icons.power_rounded : Icons.battery_charging_full_rounded,
              color: color,
              size: 26,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            label,
            style: TextStyle(
                fontSize: 17, fontWeight: FontWeight.w700, color: p.text),
          ),
          const SizedBox(height: 2),
          Text(
            'Charging state',
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w600, color: p.subtext),
          ),
        ],
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.tint,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return _Glass(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tint),
          const SizedBox(height: 10),
          Text(
            value,
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w700,
              color: p.text,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w600, color: p.subtext),
          ),
        ],
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// Accelerometer
/// ---------------------------------------------------------------------------
class _AccelCard extends StatelessWidget {
  const _AccelCard({required this.accel});

  final dynamic accel; // AccelerometerEvent? — kept loose to avoid import churn.

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    final a = accel;
    final hasData = a != null;
    final x = hasData ? (a.x as double) : 0.0;
    final y = hasData ? (a.y as double) : 0.0;
    final z = hasData ? (a.z as double) : 0.0;
    final magnitude = math.sqrt(x * x + y * y + z * z);

    return _Glass(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.vibration_rounded, size: 18, color: p.text),
              const SizedBox(width: 8),
              Text(
                'Acceleration',
                style: TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w700, color: p.text),
              ),
              const Spacer(),
              Text(
                hasData ? '${magnitude.toStringAsFixed(2)} m/s²' : '—',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: p.subtext,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _AxisBar(axis: 'X', value: x, color: const Color(0xFFFF6FA3)),
          const SizedBox(height: 12),
          _AxisBar(axis: 'Y', value: y, color: const Color(0xFF4FA9FF)),
          const SizedBox(height: 12),
          _AxisBar(axis: 'Z', value: z, color: const Color(0xFF34D399)),
        ],
      ),
    );
  }
}

/// Centre-anchored bar: 0 in the middle, ± grows outward. Clamped to ±20 m/s².
class _AxisBar extends StatelessWidget {
  const _AxisBar({required this.axis, required this.value, required this.color});

  final String axis;
  final double value;
  final Color color;

  static const _range = 20.0;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    final frac = (value / _range).clamp(-1.0, 1.0);
    return Row(
      children: [
        SizedBox(
          width: 18,
          child: Text(
            axis,
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w700, color: color),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: LayoutBuilder(
            builder: (context, c) {
              final half = c.maxWidth / 2;
              final len = half * frac.abs();
              return Container(
                height: 10,
                decoration: BoxDecoration(
                  color: p.track,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Stack(
                  children: [
                    Align(
                      alignment: Alignment.center,
                      child: Container(
                          width: 1.5, color: p.text.withValues(alpha: 0.18)),
                    ),
                    Positioned(
                      left: frac >= 0 ? half : half - len,
                      top: 0,
                      bottom: 0,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        width: len,
                        decoration: BoxDecoration(
                          color: color,
                          borderRadius: BorderRadius.circular(6),
                          boxShadow: [
                            BoxShadow(
                                color: color.withValues(alpha: 0.5),
                                blurRadius: 6),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
        const SizedBox(width: 10),
        SizedBox(
          width: 52,
          child: Text(
            value.toStringAsFixed(2),
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: p.text,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ],
    );
  }
}

/// ---------------------------------------------------------------------------
/// Section label + floating action bar
/// ---------------------------------------------------------------------------
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
          color: _Palette.of(context).subtext,
        ),
      ),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({required this.running, required this.onPressed});

  final bool running;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final gradient = running
        ? const [Color(0xFFFF5A52), Color(0xFFFF2D55)]
        : const [Color(0xFF6C5CFF), Color(0xFF9B5CFF)];
    final glow = running ? const Color(0xFFFF2D55) : const Color(0xFF6C5CFF);
    return Padding(
      padding: EdgeInsets.fromLTRB(
          16, 8, 16, 14 + MediaQuery.of(context).padding.bottom),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: glow.withValues(alpha: 0.45),
              blurRadius: 22,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onPressed,
            child: Ink(
              height: 58,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: gradient,
                ),
                border: Border.all(color: Colors.white.withValues(alpha: 0.25)),
              ),
              child: Center(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      running ? Icons.stop_rounded : Icons.play_arrow_rounded,
                      color: Colors.white,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      running ? 'Stop streaming' : 'Start streaming',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
