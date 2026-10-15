"""
Sequential integer ids, so the API keeps the numeric ids clients already use.

Hi/lo allocation: each process reserves a block of ids with one `$inc` on the
`counters` document and hands them out from memory. A single counter document
updated by every request becomes a hot spot under load (concurrent updates to
one document queue behind each other); reserving blocks cuts those writes by
the block size. Ids stay unique; they can have gaps (unused ids of a block are
dropped when a process restarts) and are only roughly ordered across processes.
"""

import asyncio
from typing import Dict, Optional, Tuple

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

BLOCK_SIZE = 50

# (database name, sequence) -> [next id to hand out, last id of the block]
_blocks: Dict[Tuple[str, str], list] = {}
_locks: Dict[Tuple[str, str], asyncio.Lock] = {}


async def next_id(db: AsyncDatabase, sequence: str, session: Optional[AsyncClientSession] = None) -> int:
    """Return a new id for `sequence`.

    `session` is accepted for call sites inside a transaction but not used:
    reserving a block happens outside it, so concurrent transactions do not
    conflict on the counter document (an aborted transaction leaves a gap).
    """
    key = (db.name, sequence)
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        block = _blocks.get(key)
        if block is None or block[0] > block[1]:
            doc = await db.counters.find_one_and_update(
                {"_id": sequence},
                {"$inc": {"seq": BLOCK_SIZE}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            block = [doc["seq"] - BLOCK_SIZE + 1, doc["seq"]]
            _blocks[key] = block
        value = block[0]
        block[0] += 1
        return value


def forget_blocks() -> None:
    """Drop reserved blocks (after a database is wiped, e.g. between tests)."""
    _blocks.clear()


async def bump_counter(db: AsyncDatabase, sequence: str, at_least: int) -> None:
    """Make sure ids handed out from now on are above `at_least` (after imports).

    Run it before the API starts: a process that already reserved a lower
    block would still hand out ids from that block.
    """
    await db.counters.update_one({"_id": sequence}, {"$max": {"seq": at_least}}, upsert=True)
