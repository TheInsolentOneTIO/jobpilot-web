import asyncio
import logging
import os
import socket
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
app = FastAPI(title="JobPilot Web API")
TRUDVSEM_URL = "https://opendata.trudvsem.ru/api/v1/vacancies"
TRUDVSEM_HOST = urlsplit(TRUDVSEM_URL).hostname or "unknown"
TRUDVSEM_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
RETRYABLE_SOURCE_STATUSES = {408, 500, 502, 503, 504}
MAX_SOURCE_ATTEMPTS = 2
logger = logging.getLogger("uvicorn.error")
LOCAL_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
PROFESSION_VARIANTS = {
    "python": ("python", "питон", "backend", "бэкенд", "django", "fastapi"),
    "javascript": ("javascript", "frontend", "фронтенд", "react", "vue", "angular"),
    "java": ("java", "spring"),
    "аналитик": ("аналитик", "analyst", "data scientist", "data analyst"),
    "дизайнер": ("дизайнер", "designer", "ux", "ui"),
}


def cors_origins() -> list[str]:
    """Return local origins plus explicitly configured public frontend origins."""
    configured = [
        origin.strip().rstrip("/")
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip() and origin.strip() != "*"
    ]
    return list(dict.fromkeys([*LOCAL_CORS_ORIGINS, *configured]))


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=[],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def source_error(source: str, status: int, detail: str) -> dict[str, str | int]:
    return {"source": source, "status": status, "detail": detail}


def request_failure_kind(error: httpx.RequestError) -> str:
    """Classify transport errors without including request data in logs."""
    if isinstance(error, httpx.ReadTimeout):
        return "read_timeout"
    if isinstance(error, httpx.ConnectTimeout):
        return "connect_timeout"
    if isinstance(error, httpx.PoolTimeout):
        return "pool_timeout"

    current: BaseException | None = error
    while current is not None:
        if isinstance(current, socket.gaierror):
            return "dns_error"
        current = current.__cause__ or current.__context__
    return "connect_error" if isinstance(error, httpx.ConnectError) else "request_error"


def log_source_result(event: str, *, attempt: int, duration_ms: int, status: int | None = None, failure: str | None = None) -> None:
    """Log only source diagnostics, never query parameters or response content."""
    logger.info(
        "trudvsem event=%s host=%s attempt=%s duration_ms=%s http_status=%s failure=%s",
        event,
        TRUDVSEM_HOST,
        attempt,
        duration_ms,
        status,
        failure,
    )


def normalize(value: Any) -> str:
    return " ".join(str(value or "").lower().replace("ё", "е").split())


def vacancy_text(vacancy: dict[str, Any]) -> str:
    return normalize(" ".join(str(vacancy.get(field) or "") for field in ("job-name", "duty", "requirements", "schedule")))


def profession_matches(vacancy: dict[str, Any], profession: str) -> bool:
    query = normalize(profession)
    if not query:
        return True
    title = normalize(vacancy.get("job-name"))
    for keyword, variants in PROFESSION_VARIANTS.items():
        if keyword in query and any(variant in title for variant in variants):
            return True
    meaningful_words = [word for word in query.split() if word not in {"разработчик", "developer", "инженер", "специалист"}]
    return bool(meaningful_words) and all(word in title for word in meaningful_words)


def format_matches(vacancy: dict[str, Any], work_format: str) -> bool:
    requested = normalize(work_format)
    if requested in {"любой", "any"}:
        return True
    if not requested:
        return False
    text = vacancy_text(vacancy)
    if "удален" in requested:
        return any(marker in text for marker in ("удален", "дистанцион", "remote"))
    if "гибрид" in requested:
        return "гибрид" in text
    if "офис" in requested:
        return any(marker in text for marker in ("офис", "на территории работодателя"))
    return False


def city_matches(vacancy: dict[str, Any], city: str, remote_allowed: bool) -> bool:
    requested = normalize(city)
    if not requested:
        return True
    region = normalize((vacancy.get("region") or {}).get("name"))
    addresses = normalize((vacancy.get("addresses") or {}).get("address"))
    if requested in region or requested in addresses:
        return True
    return remote_allowed and format_matches(vacancy, "Удалённо")


def salary_matches(vacancy: dict[str, Any], salary_min: int | None) -> bool:
    if salary_min is None:
        return True
    lower = vacancy.get("salary_min") or 0
    upper = vacancy.get("salary_max") or 0
    if not lower and not upper:
        return False
    if upper and upper < salary_min:
        return False
    return lower >= salary_min or upper >= salary_min


def matches_profile(vacancy: dict[str, Any], profession: str, city: str, salary_min: int | None, work_format: str) -> bool:
    return (
        profession_matches(vacancy, profession)
        and format_matches(vacancy, work_format)
        and city_matches(vacancy, city, normalize(work_format) in {"любой", "any"} or normalize(work_format).startswith("удален"))
        and salary_matches(vacancy, salary_min)
    )


def to_item(vacancy: dict[str, Any]) -> dict[str, Any]:
    return {"id": f"trudvsem-{vacancy['id']}", "title": vacancy.get("job-name") or "Без названия", "company": (vacancy.get("company") or {}).get("name"), "salary_from": vacancy.get("salary_min"), "salary_to": vacancy.get("salary_max"), "currency": vacancy.get("currency"), "city": (vacancy.get("region") or {}).get("name"), "url": vacancy.get("vac_url"), "source": "Работа России"}


def filter_vacancies(records: list[Any], profession: str, city: str, salary_min: int | None, work_format: str) -> list[dict[str, Any]]:
    items = []
    for entry in records:
        data = entry.get("vacancy") if isinstance(entry, dict) else None
        if not isinstance(data, dict) or not data.get("id"):
            continue
        if matches_profile(data, profession, city, salary_min, work_format):
            items.append(to_item(data))
    return items


async def fetch_trudvsem(client: httpx.AsyncClient, text: str, limit: int, offset: int, profession: str, city: str, salary_min: int | None, work_format: str) -> tuple[list[dict[str, Any]], int, dict[str, str | int] | None]:
    for attempt in range(1, MAX_SOURCE_ATTEMPTS + 1):
        started_at = time.perf_counter()
        try:
            response = await client.get(TRUDVSEM_URL, params={"text": text, "limit": limit, "offset": offset})
        except httpx.RequestError as error:
            duration_ms = round((time.perf_counter() - started_at) * 1000)
            failure = request_failure_kind(error)
            log_source_result("transport_error", attempt=attempt, duration_ms=duration_ms, failure=failure)
            if attempt < MAX_SOURCE_ATTEMPTS:
                await asyncio.sleep(0.2)
                continue
            status = 504 if isinstance(error, httpx.TimeoutException) else 502
            detail = "Work Russia API request timed out" if status == 504 else "Work Russia API is unavailable"
            return [], 0, source_error("Работа России", status, detail)

        duration_ms = round((time.perf_counter() - started_at) * 1000)
        log_source_result("response", attempt=attempt, duration_ms=duration_ms, status=response.status_code)
        if response.status_code in RETRYABLE_SOURCE_STATUSES and attempt < MAX_SOURCE_ATTEMPTS:
            await asyncio.sleep(0.2)
            continue
        if response.is_error:
            return [], 0, source_error("Работа России", response.status_code, f"Work Russia API returned {response.status_code}")
        break
    else:  # Defensive guard: the loop always returns or breaks above.
        return [], 0, source_error("Работа России", 502, "Work Russia API is unavailable")

    try:
        records = response.json().get("results", {}).get("vacancies", [])
    except ValueError:
        return [], 0, source_error("Работа России", 502, "Work Russia API returned invalid JSON")
    records = records if isinstance(records, list) else []
    return filter_vacancies(records, profession, city, salary_min, work_format), len(records), None


@app.get("/api/vacancies")
async def vacancies(profession: str = Query(default="", max_length=150), skills: str = Query(default="", max_length=200), city: str = Query(default="", max_length=100), salary_min: int | None = Query(default=None, ge=0), work_format: str = Query(default="", max_length=30), page: int = Query(default=0, ge=0), per_page: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    text = profession or skills
    async with httpx.AsyncClient(proxy=os.getenv("HTTP_PROXY") or None, timeout=TRUDVSEM_TIMEOUT, follow_redirects=True) as client:
        source_limit = 100
        items, source_total, error = await fetch_trudvsem(client, text, source_limit, page, profession, city, salary_min, work_format)
    return {"items": items[:per_page], "source_total": source_total, "matched_total": len(items), "source_errors": [error] if error else []}
