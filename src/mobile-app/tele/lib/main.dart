import 'package:flutter/material.dart';

import 'config.dart';
import 'telemetry_service.dart';

void main() => runApp(const FleetTelemetryApp());

class FleetTelemetryApp extends StatelessWidget {
  const FleetTelemetryApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Fleet Telemetry',
        theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
        home: const TelemetryScreen(),
      );
}

class TelemetryScreen extends StatefulWidget {
  const TelemetryScreen({super.key});

  @override
  State<TelemetryScreen> createState() => _TelemetryScreenState();
}

class _TelemetryScreenState extends State<TelemetryScreen> {
  final svc = TelemetryService();

  @override
  void initState() {
    super.initState();
    svc.start();
  }

  @override
  void dispose() {
    svc.dispose();
    super.dispose();
  }

  Color _statusColor(SendStatus s) => switch (s) {
        SendStatus.ok => Colors.green,
        SendStatus.sending => Colors.blue,
        SendStatus.retrying => Colors.orange,
        SendStatus.rejected || SendStatus.unauthorized => Colors.red,
        SendStatus.idle => Colors.grey,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fleet Telemetry')),
      body: ListenableBuilder(
        listenable: svc,
        builder: (context, _) {
          final a = svc.lastAccel;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _card('Device', [
                _row('deviceId', AppConfig.deviceId),
                _row('endpoint', AppConfig.ingestionUrl),
                _row('API key', AppConfig.apiKey.isEmpty ? 'MISSING' : 'set'),
                _row('interval', '${AppConfig.sendIntervalSeconds}s'),
              ]),
              _card('Latest readings', [
                _row('battery_level',
                    svc.lastBatteryRatio?.toStringAsFixed(2) ?? '—'),
                _row('charging_state', svc.lastCharging?.toString() ?? '—'),
                _row(
                    'acceleration',
                    a == null
                        ? '—'
                        : 'x ${a.x.toStringAsFixed(2)}  y ${a.y.toStringAsFixed(2)}  z ${a.z.toStringAsFixed(2)}'),
              ]),
              _card('Transmission', [
                Row(children: [
                  Icon(Icons.circle, size: 12, color: _statusColor(svc.status)),
                  const SizedBox(width: 8),
                  Text(svc.status.name.toUpperCase()),
                ]),
                const SizedBox(height: 8),
                _row('last response', svc.lastMessage),
                _row('last success',
                    svc.lastSuccessAt?.toLocal().toString().substring(11, 19) ?? '—'),
                _row('events accepted', '${svc.totalAccepted}'),
                _row('queued (offline)', '${svc.queued}'),
              ]),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: () => svc.running ? svc.stop() : svc.start(),
                icon: Icon(svc.running ? Icons.stop : Icons.play_arrow),
                label: Text(svc.running ? 'Stop streaming' : 'Start streaming'),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _card(String title, List<Widget> children) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      );

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
                width: 130,
                child: Text(k, style: const TextStyle(color: Colors.black54))),
            Expanded(child: Text(v, style: const TextStyle(fontFamily: 'monospace'))),
          ],
        ),
      );
}
