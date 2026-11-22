"""Temporary, manually invoked source connectivity diagnostic."""
import asyncio
import os
import socket
import time

import httpx

URL = "https://opendata.trudvsem.ru/api/v1/vacancies"
HOST = "opendata.trudvsem.ru"
MAX_BYTES = 2_000_000


async def dns_check():
    started = time.monotonic()
    try:
        await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(HOST, 443, type=socket.SOCK_STREAM), 5)
        status = "ok"
    except (OSError, asyncio.TimeoutError):
        status = "failed"
    return {"status": status, "duration_ms": round((time.monotonic() - started) * 1000)}


async def probe(limit, configured):
    started = time.monotonic()
    timings = {"connect_ms": None, "tls_ms": None, "ttfb_ms": None}
    starts = {}
    stage = "connecting"
    count = 0
    status = None
    redirects = None

    async def trace(name, info):
        nonlocal stage
        # HTTPX trace exposes connection and TLS timing; header completion is a TTFB approximation.
        if name in ("connection.connect_tcp.started", "connection.start_tls.started"):
            starts[name.split(".")[1]] = time.monotonic()
        elif name in ("connection.connect_tcp.complete", "connection.start_tls.complete"):
            key = name.split(".")[1]
            if key in starts:
                timings["connect_ms" if key == "connect_tcp" else "tls_ms"] = round((time.monotonic() - starts[key]) * 1000)
        elif name.endswith("receive_response_headers.started"):
            stage = "waiting_headers"
        elif name.endswith("receive_response_headers.complete"):
            stage = "reading_body"
            if timings["ttfb_ms"] is None:
                timings["ttfb_ms"] = round((time.monotonic() - started) * 1000)

    failure = None
    proxy = os.getenv("HTTP_PROXY") or None if configured else None
    try:
        async with asyncio.timeout(15):
            async with httpx.AsyncClient(proxy=proxy, trust_env=configured, timeout=httpx.Timeout(connect=5, read=10, write=5, pool=5), follow_redirects=True) as client:
                async with client.stream("GET", URL, params={"text": "", "limit": limit, "offset": 0}, extensions={"trace": trace}) as response:
                    status = response.status_code
                    redirects = len(response.history)
                    async for chunk in response.aiter_bytes():
                        count += len(chunk)
                        if count > MAX_BYTES:
                            failure = "body_limit"
                            break
    except httpx.ReadTimeout:
        failure = "read_timeout"
    except httpx.ConnectTimeout:
        failure = "connect_timeout"
    except httpx.RequestError:
        failure = "request_error"
    except TimeoutError:
        failure = "total_timeout"
    return {"mode": "configured" if configured else "direct", "limit": limit, "status": status, "redirects": redirects, **timings, "total_ms": round((time.monotonic() - started) * 1000), "bytes_read": count, "failure": failure, "stage": stage if failure else "complete"}


async def run_diagnostic():
    dns = await dns_check()
    results = []
    for configured in (True, False):
        for limit in (1, 100):
            results.append(await probe(limit, configured))
    return {"dns": dns, "results": results, "timing_notes": "DNS is a separate local lookup; connect may include DNS or target a configured proxy. TTFB is elapsed time to complete response headers, including connection and redirects."}
