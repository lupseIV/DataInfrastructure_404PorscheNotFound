"""Timestamp normalisation and travel status, used by the processor and the event Lambdas."""
from .checks import parse_timestamp

# GPS speed thresholds (m/s) for travelStatus: ~1.8 km/h and ~18 km/h.
WALKING_SPEED_MPS = 0.5
VEHICLE_SPEED_MPS = 5.0


def normalize_timestamp(ts):
    """Exact YYYY-MM-DDTHH:MM:SSZ (second precision) so string order == time order."""
    return parse_timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def derive_travel_status(heading):
    """stationary | walking | in_vehicle from the raw GPS speed; unknown until a heading arrives."""
    if not heading:
        return "unknown"
    speed = float(heading["speedMps"])
    if speed >= VEHICLE_SPEED_MPS:
        return "in_vehicle"
    if speed >= WALKING_SPEED_MPS:
        return "walking"
    return "stationary"
