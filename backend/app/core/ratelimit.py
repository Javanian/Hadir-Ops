"""Per-client rate limits for the endpoints that guess passwords.

Built on `limits` (the library slowapi wraps) as a plain FastAPI dependency;
slowapi itself calls asyncio.iscoroutinefunction, which Python 3.16 removes.

Keyed on the client address. Behind a reverse proxy that address is the proxy's
unless uvicorn trusts its X-Forwarded-For header (FORWARDED_ALLOW_IPS); without
that, every employee would share a single login budget at the morning rush.
Counters live in process memory, so each uvicorn worker keeps its own.
"""

import time

from fastapi import Depends, HTTPException, Request, status
from limits import parse
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter

_storage = MemoryStorage()
_limiter = MovingWindowRateLimiter(_storage)


def rate_limit(limit: str, scope: str):
    """Dependency refusing a client with 429 once it exceeds `limit` (e.g. "10/minute")."""
    item = parse(limit)

    async def check(request: Request) -> None:
        key = request.client.host if request.client else "unknown"
        if await _limiter.hit(item, scope, key):
            return
        stats = await _limiter.get_window_stats(item, scope, key)
        retry_after = max(1, int(stats.reset_time - time.time()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: {limit}",
            headers={"Retry-After": str(retry_after)},
        )

    return Depends(check)


async def reset() -> None:
    """Forget every counter (tests)."""
    await _storage.reset()
