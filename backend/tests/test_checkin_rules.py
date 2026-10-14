from datetime import datetime, timedelta, timezone

import pytest

from app.services import checkin_rules as rules

NOW = datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc)
KW = dict(offline_threshold_s=120, max_age_hours=72, clock_tolerance_s=300)


def test_no_device_time_means_now():
    ev = rules.resolve_event_time(NOW, None, None, **KW)
    assert ev.at == NOW and not ev.is_offline and ev.flags == []


def test_monotonic_age_sets_event_time_and_marks_offline():
    ev = rules.resolve_event_time(NOW, NOW - timedelta(hours=2), 2 * 3600 * 1000, **KW)
    assert ev.at == NOW - timedelta(hours=2)
    assert ev.is_offline
    assert ev.flags == [rules.OFFLINE_SYNC]


def test_small_delay_is_not_offline():
    ev = rules.resolve_event_time(NOW, NOW - timedelta(seconds=30), 30_000, **KW)
    assert not ev.is_offline and ev.flags == []


def test_clock_disagreement_keeps_phone_time_and_flags_it():
    # Phone says it was pressed 1 h ago; its monotonic clock says 10 minutes.
    # Either the clock was moved back or the phone slept: a person decides.
    claimed = NOW - timedelta(hours=1)
    ev = rules.resolve_event_time(NOW, claimed, 10 * 60 * 1000, **KW)
    assert ev.at == claimed
    assert rules.CLOCK_MISMATCH in ev.flags
    assert rules.review_needed(ev.flags)


def test_future_claim_is_refused_even_with_monotonic_age():
    with pytest.raises(rules.EventTimeError):
        rules.resolve_event_time(NOW, NOW + timedelta(hours=2), 1000, **KW)


def test_late_event_without_monotonic_age_is_unverified():
    ev = rules.resolve_event_time(NOW, NOW - timedelta(hours=3), None, **KW)
    assert ev.at == NOW - timedelta(hours=3)
    assert rules.CLOCK_UNVERIFIED in ev.flags and rules.OFFLINE_SYNC in ev.flags


def test_future_event_is_refused():
    with pytest.raises(rules.EventTimeError):
        rules.resolve_event_time(NOW, NOW + timedelta(hours=1), None, **KW)


def test_small_future_skew_is_clamped():
    ev = rules.resolve_event_time(NOW, NOW + timedelta(seconds=20), None, **KW)
    assert ev.at == NOW


def test_event_older_than_limit_is_refused():
    with pytest.raises(rules.EventTimeError):
        rules.resolve_event_time(NOW, None, 73 * 3600 * 1000, **KW)


@pytest.mark.parametrize(
    "distance, accuracy, inside, flags",
    [
        (50, 10, True, []),                                  # inside
        (140, 60, True, [rules.LOW_GPS_ACCURACY]),           # circle touches the radius
        (140, 20, False, []),                                # clearly outside
        (400, 5000, False, []),                              # huge accuracy is capped at 150
        (240, 5000, True, [rules.LOW_GPS_ACCURACY]),         # within cap
        (90, None, True, [rules.GPS_ACCURACY_UNKNOWN]),
    ],
)
def test_geofence(distance, accuracy, inside, flags):
    res = rules.evaluate_geofence(distance, 100, accuracy, accuracy_cap_m=150)
    assert res.in_radius is inside
    assert res.flags == flags


def test_review_needed():
    assert not rules.review_needed([rules.OFFLINE_SYNC])
    assert not rules.review_needed([rules.GPS_ACCURACY_UNKNOWN], "ONTIME")
    assert rules.review_needed([], "OUT_OF_RADIUS")
    assert rules.review_needed([rules.MOCK_LOCATION])
    assert rules.review_needed(["CHECKOUT_FACE_NOT_VERIFIED"])
    assert not rules.review_needed(["CHECKOUT_OFFLINE_SYNC"])
