"""
Check-in rules that do not touch the database.

Kept separate so they can be tested directly:
  - resolve_event_time: which moment a (possibly offline, possibly late) event happened
  - evaluate_geofence:  inside / uncertain / outside, using the GPS accuracy circle
  - review_needed:      which risk flags send a record to the supervisor review queue

Principle: a failure of the phone, the network or the GPS should leave a record
with a flag for a person to judge, not a rejected check-in.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional

# ── Risk flags ─────────────────────────────────────────────────────────────────

MOCK_LOCATION = "MOCK_LOCATION"            # OS reported a mocked location provider
LOW_GPS_ACCURACY = "LOW_GPS_ACCURACY"      # accuracy circle touches the site, centre is outside
GPS_ACCURACY_UNKNOWN = "GPS_ACCURACY_UNKNOWN"
FACE_NOT_VERIFIED = "FACE_NOT_VERIFIED"    # no valid face token (offline or skipped)
CLOCK_MISMATCH = "CLOCK_MISMATCH"          # device wall clock disagrees with monotonic age
CLOCK_UNVERIFIED = "CLOCK_UNVERIFIED"      # late event with no monotonic age to check it
OFFLINE_SYNC = "OFFLINE_SYNC"              # delivered later than it happened (informational)

CHECKOUT_PREFIX = "CHECKOUT_"

# Flags that put a record in the review queue. OFFLINE_SYNC and
# GPS_ACCURACY_UNKNOWN alone are informational.
REVIEW_FLAGS = {
    MOCK_LOCATION,
    LOW_GPS_ACCURACY,
    FACE_NOT_VERIFIED,
    CLOCK_MISMATCH,
    CLOCK_UNVERIFIED,
}


def review_needed(flags: List[str], status: Optional[str] = None) -> bool:
    if status == "OUT_OF_RADIUS":
        return True
    for flag in flags:
        base = flag[len(CHECKOUT_PREFIX):] if flag.startswith(CHECKOUT_PREFIX) else flag
        if base in REVIEW_FLAGS:
            return True
    return False


# ── Event time ─────────────────────────────────────────────────────────────────

class EventTimeError(ValueError):
    """The event cannot be accepted (in the future or too old)."""


@dataclass
class EventTime:
    at: datetime                 # the moment used for attendance logic (UTC, aware)
    is_offline: bool
    flags: List[str] = field(default_factory=list)


def resolve_event_time(
    received_at: datetime,
    captured_at: Optional[datetime],
    capture_age_ms: Optional[int],
    *,
    offline_threshold_s: int,
    max_age_hours: int,
    clock_tolerance_s: int,
) -> EventTime:
    """
    Decide when an event happened.

    received_at     server time when the request arrived (aware UTC)
    captured_at     device wall-clock time when the user pressed the button
    capture_age_ms  milliseconds elapsed since capture, measured by the device's
                    monotonic clock at send time. Moving the phone's clock does not
                    change it, so it is used to check captured_at.

    When both agree, the event time is proven. When they disagree, the phone's
    clock was changed or the monotonic clock paused while the phone slept
    (Android's does). The two cannot be told apart here, so the time the phone
    recorded is kept and the record goes to review with CLOCK_MISMATCH.
    """
    flags: List[str] = []

    if captured_at is None and capture_age_ms is None:
        return EventTime(at=received_at, is_offline=False)

    if captured_at is not None and captured_at - received_at > timedelta(seconds=clock_tolerance_s):
        raise EventTimeError("Event time is in the future. Check the phone's date and time.")

    if capture_age_ms is not None:
        mono_at = received_at - timedelta(milliseconds=capture_age_ms)
        at = mono_at
        if captured_at is not None:
            drift = abs((captured_at - mono_at).total_seconds())
            if drift > clock_tolerance_s:
                flags.append(CLOCK_MISMATCH)
                at = captured_at
    else:
        at = captured_at
    if at > received_at:
        at = received_at  # small skew: clamp, never record a future check-in

    age = received_at - at
    if age > timedelta(hours=max_age_hours):
        raise EventTimeError(
            f"Event is older than {max_age_hours} hours and can no longer be synced. "
            "Ask your supervisor to record it."
        )

    is_offline = age > timedelta(seconds=offline_threshold_s)
    if is_offline:
        flags.append(OFFLINE_SYNC)
        if capture_age_ms is None:
            flags.append(CLOCK_UNVERIFIED)

    return EventTime(at=at, is_offline=is_offline, flags=flags)


# ── Geofence ───────────────────────────────────────────────────────────────────

@dataclass
class GeofenceResult:
    in_radius: bool
    distance_m: float
    flags: List[str] = field(default_factory=list)


def evaluate_geofence(
    distance_m: float,
    radius_m: float,
    accuracy_m: Optional[float],
    *,
    accuracy_cap_m: float,
) -> GeofenceResult:
    """
    Inside if the reported point is inside the radius.
    Uncertain (accepted, flagged) if the accuracy circle reaches the radius.
    Accuracy is capped so a 3 km reading cannot validate any location.
    """
    flags: List[str] = []
    if accuracy_m is None:
        flags.append(GPS_ACCURACY_UNKNOWN)
        return GeofenceResult(in_radius=distance_m <= radius_m, distance_m=distance_m, flags=flags)

    if distance_m <= radius_m:
        return GeofenceResult(in_radius=True, distance_m=distance_m, flags=flags)

    if distance_m - min(accuracy_m, accuracy_cap_m) <= radius_m:
        flags.append(LOW_GPS_ACCURACY)
        return GeofenceResult(in_radius=True, distance_m=distance_m, flags=flags)

    return GeofenceResult(in_radius=False, distance_m=distance_m, flags=flags)
