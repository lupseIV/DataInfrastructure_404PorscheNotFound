import 'package:geolocator/geolocator.dart';

/// A single raw GPS fix, pre-shaped for the contract's `location` /
/// `motion_heading` objects. No math beyond normalizing the raw platform
/// values into their documented ranges (the cloud does all real processing).
class GeoSample {
  final double lat;
  final double lon;
  final double accuracyM;
  final double? altitudeM;
  final double headingDegrees; // 0..360
  final double speedMps; // >= 0
  final String capturedAt; // ISO-8601 UTC, trailing Z

  const GeoSample({
    required this.lat,
    required this.lon,
    required this.accuracyM,
    required this.altitudeM,
    required this.headingDegrees,
    required this.speedMps,
    required this.capturedAt,
  });

  factory GeoSample.fromPosition(Position p) {
    double heading = p.heading;
    if (heading.isNaN || heading.isInfinite || heading < 0) heading = 0;
    heading = heading % 360;
    double speed = p.speed;
    if (speed.isNaN || speed.isInfinite || speed < 0) speed = 0;
    double acc = p.accuracy;
    if (acc.isNaN || acc.isInfinite || acc < 0) acc = 0;
    final iso = p.timestamp.toUtc().toIso8601String();
    return GeoSample(
      lat: p.latitude,
      lon: p.longitude,
      accuracyM: acc,
      altitudeM: p.altitude.isNaN ? null : p.altitude,
      headingDegrees: heading,
      speedMps: speed,
      capturedAt: '${iso.substring(0, 19)}Z',
    );
  }

  /// Contract A `location` value (no capturedAt; timestamp is on the event).
  Map<String, Object> locationValue() => {
        'lat': lat,
        'lon': lon,
        'accuracyM': accuracyM,
        if (altitudeM != null) 'altitudeM': altitudeM!,
      };

  /// Contract D1/D2 `location` / `lastKnownLocation` object (with capturedAt).
  Map<String, Object> locationWithCapturedAt() => {
        'lat': lat,
        'lon': lon,
        'accuracyM': accuracyM,
        'capturedAt': capturedAt,
      };

  /// `motion_heading` value / Contract D `heading` object.
  Map<String, Object> headingValue() => {
        'degrees': headingDegrees,
        'speedMps': speedMps,
      };
}
