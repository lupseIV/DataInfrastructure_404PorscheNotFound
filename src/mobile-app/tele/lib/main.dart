import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import 'device_identity.dart';
import 'telemetry_service.dart';

void main() => runApp(const FleetTelemetryApp());

/// ---------------------------------------------------------------------------
/// Palette — "Industrial Fleet Telemetry" dark-slate design system.
/// Flat tonal surfaces + 1px hairline borders; emerald primary = healthy;
/// amber = warning, crimson = critical, cyan = charging, slate = offline.
/// ---------------------------------------------------------------------------
class _Palette {
  const _Palette();
  factory _Palette.of(BuildContext _) => const _Palette();

  // Tonal surface layers (lowest -> highest).
  static const bg = Color(0xFF0B1326); // page / canvas
  static const panel = Color(0xFF0D162B); // header / bottom bar
  static const card = Color(0xFF131B2E); // surface-container-low (cards)
  static const cardHigh = Color(0xFF171F33); // elevated / strong cards
  static const deep = Color(0xFF060E20); // inputs, progress tracks

  Color get text => const Color(0xFFDAE2FD); // on-surface
  Color get subtext => const Color(0xFF86948A); // muted
  Color get border => const Color(0xFF1E293B); // 1px hairline
  Color get track => deep; // recessed tracks
  bool get dark => true;

  // Semantic status colours (communicate state only, never decoration).
  static const primary = Color(0xFF10B981); // emerald — healthy / brand
  static const ok = Color(0xFF10B981);
  static const info = Color(0xFF3B82F6); // blue — medium
  static const warn = Color(0xFFF59E0B); // amber — warning / low
  static const danger = Color(0xFFEF4444); // crimson — critical
  static const charging = Color(0xFF22D3EE); // cyan — charging
  static const offline = Color(0xFF64748B); // slate — offline / idle
}

/// Soft (4px) corner scale; large containers use 8px.
const _radius = 8.0;
const _radiusSmall = 4.0;

/// JetBrains Mono for all quantitative telemetry (tabular numerals so live
/// values don't jitter horizontally).
TextStyle _mono({
  double size = 14,
  FontWeight weight = FontWeight.w500,
  Color? color,
  double spacing = 0,
  double height = 1.0,
}) =>
    GoogleFonts.jetBrainsMono(
      fontSize: size,
      fontWeight: weight,
      color: color,
      letterSpacing: spacing,
      height: height,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

/// Uppercase label-sm: section headers, KPI titles, badges.
TextStyle _labelSm(Color color) => GoogleFonts.inter(
      fontSize: 11,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.44, // ~0.04em
      color: color,
    );

class FleetTelemetryApp extends StatelessWidget {
  const FleetTelemetryApp({super.key});

  ThemeData _theme() {
    final base = ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: _Palette.primary,
        brightness: Brightness.dark,
        surface: _Palette.bg,
      ),
      useMaterial3: true,
      scaffoldBackgroundColor: _Palette.bg,
    );
    // Inter for all UI chrome.
    return base.copyWith(
      textTheme: GoogleFonts.interTextTheme(base.textTheme)
          .apply(bodyColor: const Color(0xFFDAE2FD), displayColor: const Color(0xFFDAE2FD)),
    );
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Fleet Telemetry',
        debugShowCheckedModeBanner: false,
        theme: _theme(),
        darkTheme: _theme(),
        themeMode: ThemeMode.dark,
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
        SendStatus.idle => const _StatusLook(_Palette.offline,
            Icons.pause_circle_rounded, 'Paused', 'Telemetry capture is stopped'),
      };

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return Scaffold(
      backgroundColor: _Palette.bg,
      extendBody: true,
      body: SafeArea(
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
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
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
                        IntrinsicHeight(
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
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
                _ActionBar(
                  running: svc.running,
                  onPressed: () => svc.running ? svc.stop() : svc.start(),
                ),
              ],
            );
          },
        ),
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
/// Flat card — the industrial surface: tonal fill + 1px hairline border.
/// [tint] gives a card a semantic border + faint wash (e.g. the status hero).
/// ---------------------------------------------------------------------------
class _Card extends StatelessWidget {
  const _Card({
    required this.child,
    this.tint,
    this.strong = false,
  });

  final Widget child;
  final Color? tint;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    const shape = BorderRadius.all(Radius.circular(_radius));
    final fill = strong ? _Palette.cardHigh : _Palette.card;
    return RepaintBoundary(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: fill,
          borderRadius: shape,
          border: Border.all(
            color: tint != null
                ? tint!.withValues(alpha: 0.45)
                : const Color(0xFF1E293B),
            width: 1,
          ),
        ),
        child: Stack(
          children: [
            if (tint != null)
              Positioned.fill(
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: shape,
                      color: tint!.withValues(alpha: 0.07),
                    ),
                  ),
                ),
              ),
            Padding(padding: const EdgeInsets.all(16), child: child),
          ],
        ),
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// Header — logo + title, mono device id, LIVE badge, hairline bottom border.
/// ---------------------------------------------------------------------------
class _Header extends StatelessWidget {
  const _Header({required this.deviceId, required this.running});

  final String deviceId;
  final bool running;

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: _Palette.panel,
        border: Border(bottom: BorderSide(color: Color(0xFF1E293B))),
      ),
      child: Row(
        children: [
          Container(
            height: 38,
            width: 38,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(_radius),
              color: _Palette.primary.withValues(alpha: 0.15),
              border: Border.all(color: _Palette.primary.withValues(alpha: 0.5)),
            ),
            child: const Icon(Icons.radar_rounded, color: _Palette.primary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Fleet Telemetry',
                  style: GoogleFonts.inter(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: p.text,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 2),
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
                          style: _mono(size: 12, color: p.subtext),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Icon(Icons.content_copy_rounded, size: 11, color: p.subtext),
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

/// Compact 4px status chip with a 6px dot.
class _Chip extends StatelessWidget {
  const _Chip({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(_radiusSmall),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            height: 6,
            width: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(label, style: _labelSm(color)),
        ],
      ),
    );
  }
}

class _LivePill extends StatelessWidget {
  const _LivePill({required this.running});
  final bool running;

  @override
  Widget build(BuildContext context) => _Chip(
        color: running ? _Palette.primary : _Palette.offline,
        label: running ? 'LIVE' : 'OFF',
      );
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
    return _Card(
      tint: look.color,
      strong: true,
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
                      style: GoogleFonts.inter(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: p.text,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      look.subtitle,
                      style: GoogleFonts.inter(fontSize: 12.5, color: p.subtext),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(height: 1, color: p.border),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _HeroFact(
                    label: 'Last success', value: _timeAgo(lastSuccess)),
              ),
              Container(width: 1, height: 28, color: p.border),
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
          Text(label.toUpperCase(), style: _labelSm(p.subtext)),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: mono
                ? _mono(size: 13, weight: FontWeight.w500, color: p.text)
                : GoogleFonts.inter(
                    fontSize: 14, fontWeight: FontWeight.w600, color: p.text),
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
      height: 48,
      width: 48,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (animate)
            RepaintBoundary(
              child: AnimatedBuilder(
                animation: controller,
                builder: (context, child) {
                  final t = controller.value;
                  return Container(
                    height: 34 + 14 * t,
                    width: 34 + 14 * t,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(_radiusSmall),
                      color: color.withValues(alpha: 0.18 * (1 - t)),
                    ),
                  );
                },
              ),
            ),
          Container(
            height: 42,
            width: 42,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(_radius),
              color: color.withValues(alpha: 0.15),
              border: Border.all(color: color.withValues(alpha: 0.5)),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
        ],
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// Live-reading tiles (KPI cards)
/// ---------------------------------------------------------------------------
class _BatteryTile extends StatelessWidget {
  const _BatteryTile({required this.ratio, required this.charging});

  final double? ratio;
  final bool? charging;

  Color _color() {
    final r = ratio;
    if (r == null) return _Palette.offline;
    if (r < 0.20) return _Palette.danger;
    if (r < 0.40) return _Palette.warn;
    if (r < 0.70) return _Palette.info;
    return _Palette.primary;
  }

  @override
  Widget build(BuildContext context) {
    final p = _Palette.of(context);
    final r = ratio;
    final pct = r == null ? '—' : '${(r * 100).round()}';
    final color = _color();
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('BATTERY', style: _labelSm(p.subtext)),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(pct, style: _mono(size: 28, weight: FontWeight.w600, color: p.text)),
              const SizedBox(width: 2),
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text('%', style: _mono(size: 14, color: p.subtext)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(_radiusSmall),
            child: LinearProgressIndicator(
              value: r ?? 0,
              minHeight: 6,
              backgroundColor: p.track,
              valueColor: AlwaysStoppedAnimation(color),
            ),
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
    final color = on ? _Palette.charging : _Palette.offline;
    final label = c == null
        ? '—'
        : on
            ? 'Plugged in'
            : 'On battery';
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('CHARGING STATE', style: _labelSm(p.subtext)),
          const SizedBox(height: 12),
          Container(
            height: 40,
            width: 40,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(_radius),
              border: Border.all(color: color.withValues(alpha: 0.45)),
            ),
            child: Icon(
              on ? Icons.bolt_rounded : Icons.battery_std_rounded,
              color: color,
              size: 22,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            label,
            style: GoogleFonts.inter(
                fontSize: 15, fontWeight: FontWeight.w600, color: p.text),
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
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: tint),
              const SizedBox(width: 6),
              Expanded(child: Text(label.toUpperCase(), style: _labelSm(p.subtext))),
            ],
          ),
          const SizedBox(height: 12),
          Text(value, style: _mono(size: 26, weight: FontWeight.w600, color: p.text)),
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

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('ACCELERATION', style: _labelSm(p.subtext)),
              const Spacer(),
              Text(
                hasData ? '${magnitude.toStringAsFixed(2)} m/s²' : '—',
                style: _mono(size: 12, color: p.subtext),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _AxisBar(axis: 'X', value: x, color: _Palette.warn),
          const SizedBox(height: 12),
          _AxisBar(axis: 'Y', value: y, color: _Palette.info),
          const SizedBox(height: 12),
          _AxisBar(axis: 'Z', value: z, color: _Palette.primary),
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
          width: 16,
          child: Text(axis, style: _mono(size: 12, weight: FontWeight.w600, color: color)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: LayoutBuilder(
            builder: (context, c) {
              final half = c.maxWidth / 2;
              final len = half * frac.abs();
              return Container(
                height: 8,
                decoration: BoxDecoration(
                  color: p.track,
                  borderRadius: BorderRadius.circular(_radiusSmall),
                ),
                child: Stack(
                  children: [
                    Align(
                      alignment: Alignment.center,
                      child: Container(
                          width: 1, color: p.text.withValues(alpha: 0.15)),
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
                          borderRadius: BorderRadius.circular(_radiusSmall),
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
            style: _mono(size: 12, color: p.text),
          ),
        ),
      ],
    );
  }
}

/// ---------------------------------------------------------------------------
/// Section label + bottom action bar
/// ---------------------------------------------------------------------------
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Text(text.toUpperCase(), style: _labelSm(_Palette.of(context).subtext)),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({required this.running, required this.onPressed});

  final bool running;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    // Primary (start) = emerald fill, dark text. Stop = crimson fill, white text.
    final fill = running ? _Palette.danger : _Palette.primary;
    final fg = running ? Colors.white : _Palette.bg;
    return Container(
      padding: EdgeInsets.fromLTRB(
          16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(
        color: _Palette.panel,
        border: Border(top: BorderSide(color: Color(0xFF1E293B))),
      ),
      child: Material(
        color: fill,
        borderRadius: BorderRadius.circular(_radius),
        child: InkWell(
          borderRadius: BorderRadius.circular(_radius),
          onTap: onPressed,
          child: SizedBox(
            height: 48,
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    running ? Icons.stop_rounded : Icons.play_arrow_rounded,
                    color: fg,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    running ? 'Stop streaming' : 'Start streaming',
                    style: GoogleFonts.inter(
                      color: fg,
                      fontSize: 15,
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
    );
  }
}
