"""MongoDB data layer: document shapes, ids, schema, relations and locks."""

from typing import Awaitable, Callable, TypeVar

from pymongo.asynchronous.client_session import AsyncClientSession

T = TypeVar("T")


async def in_transaction(callback: Callable[[AsyncClientSession], Awaitable[T]]) -> T:
    """Run `callback(session)` in a multi-document transaction.

    `with_transaction` retries on transient errors such as a write conflict,
    which is how concurrent requests touching the same document get serialised.
    Any other exception (an HTTPException, for example) aborts and propagates.
    """
    from app.core.database import client

    async with client.start_session() as session:
        return await session.with_transaction(callback)
