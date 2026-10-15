"""
Indexes and validators — the MongoDB counterpart of the old SQL schema.

`ensure_schema` is idempotent: the API runs it at startup and the seed and
test setup call it too, so a fresh database is usable without a migration
step. Unique indexes carry the guarantees the check-in flow depends on:

  - one check-in per user per site-local work date
  - a client event id (check-in, check-out, failed attempt) is stored once
"""

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import CollectionInvalid

_STRING = {"$type": "string"}

INDEXES = {
    "users": [
        IndexModel([("email", ASCENDING)], unique=True),
        IndexModel([("employee_id", ASCENDING)], unique=True),
        IndexModel([("supervisor_id", ASCENDING)]),
        IndexModel([("site_id", ASCENDING)]),
    ],
    "sites": [IndexModel([("name", ASCENDING)], unique=True)],
    "shifts": [
        IndexModel([("site_id", ASCENDING)]),
        IndexModel([("work_schedules.id", ASCENDING)]),
    ],
    "holidays": [IndexModel([("holiday_date", ASCENDING)], unique=True)],
    "attendance": [
        IndexModel(
            [("user_id", ASCENDING), ("work_date", ASCENDING)],
            unique=True,
            partialFilterExpression={"work_date": _STRING},
            name="uq_user_work_date",
        ),
        IndexModel(
            [("client_event_id", ASCENDING)],
            unique=True,
            partialFilterExpression={"client_event_id": _STRING},
            name="uq_client_event",
        ),
        IndexModel(
            [("checkout_event_id", ASCENDING)],
            unique=True,
            partialFilterExpression={"checkout_event_id": _STRING},
            name="uq_checkout_event",
        ),
        IndexModel([("user_id", ASCENDING), ("checkin_time", DESCENDING)]),
        IndexModel([("checkin_time", DESCENDING)]),
        IndexModel([("checkout_time", ASCENDING), ("user_id", ASCENDING)], name="open_records"),
        IndexModel([("needs_review", ASCENDING), ("checkin_time", DESCENDING)]),
    ],
    "checkin_attempts": [
        IndexModel([("client_event_id", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("captured_at", DESCENDING)]),
    ],
    "overtime_requests": [
        IndexModel([("attendance_id", ASCENDING)]),
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("created_at", DESCENDING)]),
    ],
    "leave_requests": [
        IndexModel([("user_id", ASCENDING), ("start_date", ASCENDING), ("end_date", ASCENDING)]),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
    ],
    "temporary_assignments": [
        IndexModel([("user_id", ASCENDING), ("start_date", ASCENDING), ("end_date", ASCENDING)]),
        IndexModel([("site_id", ASCENDING)]),
    ],
    "audit_logs": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)])],
}

# Document validation for the rules the old schema enforced with CHECK
# constraints. Dates are ISO strings, so comparing them as text is correct.
VALIDATORS = {
    "leave_requests": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["user_id", "leave_type", "start_date", "end_date", "reason", "status"],
            "properties": {
                "leave_type": {"enum": ["SICK", "PERMIT", "ANNUAL"]},
                "status": {"enum": ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]},
                "start_date": {"bsonType": "string"},
                "end_date": {"bsonType": "string"},
            },
        },
        "$expr": {"$gte": ["$end_date", "$start_date"]},
    },
    "temporary_assignments": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["user_id", "site_id", "shift_id", "start_date", "end_date"],
        },
        "$expr": {"$gte": ["$end_date", "$start_date"]},
    },
    "attendance": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["user_id", "checkin_time"],
            "properties": {
                "checkin_time": {"bsonType": "date"},
                "risk_flags": {"bsonType": "array", "items": {"bsonType": "string"}},
            },
        },
    },
    "users": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["employee_id", "name", "email", "password_hash", "role"],
            "properties": {"role": {"enum": ["ADMIN", "SUPERVISOR", "EMPLOYEE", "SALES"]}},
        },
    },
}


async def ensure_schema(db: AsyncDatabase) -> None:
    existing = set(await db.list_collection_names())
    for name, validator in VALIDATORS.items():
        if name in existing:
            await db.command("collMod", name, validator=validator)
        else:
            try:
                await db.create_collection(name, validator=validator)
            except CollectionInvalid:
                await db.command("collMod", name, validator=validator)
    for name, indexes in INDEXES.items():
        await db[name].create_indexes(indexes)
