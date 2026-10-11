import asyncio
import os
import socket
import unittest
from unittest.mock import patch

import httpx

from app.main import cors_origins, fetch_trudvsem, filter_vacancies, matches_profile, request_failure_kind


def vacancy(*, vacancy_id="1", title="Python developer", region="Москва", salary_min=180000, salary_max=250000, duty="Удалённая работа"):
    return {
        "id": vacancy_id,
        "job-name": title,
        "region": {"name": region},
        "salary_min": salary_min,
        "salary_max": salary_max,
        "duty": duty,
        "requirements": "",
        "schedule": "Полный рабочий день",
    }


class ProfileFilteringTests(unittest.TestCase):
    def test_cors_includes_configured_public_origin_and_keeps_local_origins(self):
        with patch.dict(os.environ, {"CORS_ORIGINS": "https://jobpilot.example.com/, https://staging.example.com"}, clear=False):
            origins = cors_origins()
        self.assertIn("https://jobpilot.example.com", origins)
        self.assertIn("https://staging.example.com", origins)
        self.assertIn("http://127.0.0.1:5173", origins)

    def test_moscow_rejects_other_region_when_vacancy_is_not_remote(self):
        self.assertFalse(matches_profile(vacancy(region="Брянская область", duty="Работа в офисе"), "Python-разработчик", "Москва", 180000, "Офис"))

    def test_remote_vacancy_can_match_another_region_when_remote_is_allowed(self):
        self.assertTrue(matches_profile(vacancy(region="Брянская область"), "Python-разработчик", "Москва", 180000, "Удалённо"))

    def test_unknown_format_is_not_a_match(self):
        self.assertFalse(matches_profile(vacancy(duty="Полный рабочий день"), "Python-разработчик", "Москва", 180000, "Удалённо"))

    def test_any_format_accepts_known_and_unknown_format(self):
        self.assertTrue(matches_profile(vacancy(duty="Полный рабочий день"), "Python-разработчик", "Москва", 180000, "Любой"))

    def test_empty_profile_with_any_format_keeps_all_valid_vacancies(self):
        records = [
            {"vacancy": vacancy(vacancy_id="no-salary", salary_min=0, salary_max=0, duty="")},
            {"vacancy": vacancy(vacancy_id="other-city", region="Брянская область", duty="")},
        ]
        items = filter_vacancies(records, "", "", None, "any")
        self.assertEqual({item["id"] for item in items}, {"trudvsem-no-salary", "trudvsem-other-city"})

    def test_known_maximum_below_required_salary_is_rejected(self):
        self.assertFalse(matches_profile(vacancy(salary_min=100000, salary_max=170000), "Python-разработчик", "Москва", 180000, "Удалённо"))

    def test_unknown_salary_is_not_a_match(self):
        self.assertFalse(matches_profile(vacancy(salary_min=0, salary_max=0), "Python-разработчик", "Москва", 180000, "Удалённо"))

    def test_relevant_backend_variant_matches_python_profile(self):
        self.assertTrue(matches_profile(vacancy(title="Backend-разработчик", duty="Удалённая работа"), "Python developer", "Москва", 180000, "Удалённо"))

    def test_filter_reports_only_matching_vacancies(self):
        records = [
            {"vacancy": vacancy(vacancy_id="matching")},
            {"vacancy": vacancy(vacancy_id="salary", salary_max=170000)},
            {"vacancy": vacancy(vacancy_id="city", region="Брянская область", duty="Работа в офисе")},
        ]
        items = filter_vacancies(records, "Python-разработчик", "Москва", 180000, "Удалённо")
        self.assertEqual([item["id"] for item in items], ["trudvsem-matching"])

    def test_source_pagination_offset_and_count_are_preserved(self):
        async def run():
            async def handler(request):
                self.assertEqual(request.url.params["offset"], "1")
                return httpx.Response(200, json={"results": {"vacancies": [{"vacancy": vacancy()}]}})

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await fetch_trudvsem(client, "Python", 100, 1, "Python-разработчик", "Москва", 180000, "Удалённо")

        items, source_total, error = asyncio.run(run())
        self.assertEqual(source_total, 1)
        self.assertEqual(len(items), 1)
        self.assertIsNone(error)

    def test_read_timeout_is_retried_once_and_logged_without_query_data(self):
        async def run():
            calls = 0

            async def handler(request):
                nonlocal calls
                calls += 1
                raise httpx.ReadTimeout("read timed out", request=request)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                with self.assertLogs("uvicorn.error", level="INFO") as logs:
                    result = await fetch_trudvsem(client, "private search", 100, 0, "", "", None, "any")
            return calls, result, logs.output

        calls, (_, _, error), logs = asyncio.run(run())
        self.assertEqual(calls, 2)
        self.assertEqual(error["status"], 504)
        self.assertTrue(any("host=opendata.trudvsem.ru" in line and "failure=read_timeout" in line for line in logs))
        self.assertFalse(any("private search" in line for line in logs))

    def test_temporary_server_error_is_retried_once(self):
        async def run():
            calls = 0

            async def handler(request):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return httpx.Response(503, request=request)
                return httpx.Response(200, json={"results": {"vacancies": [{"vacancy": vacancy()}]}}, request=request)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                result = await fetch_trudvsem(client, "", 100, 0, "", "", None, "any")
            return calls, result

        calls, (items, _, error) = asyncio.run(run())
        self.assertEqual(calls, 2)
        self.assertEqual(len(items), 1)
        self.assertIsNone(error)

    def test_forbidden_response_is_not_retried(self):
        async def run():
            calls = 0

            async def handler(request):
                nonlocal calls
                calls += 1
                return httpx.Response(403, request=request)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                result = await fetch_trudvsem(client, "", 100, 0, "", "", None, "any")
            return calls, result

        calls, (_, _, error) = asyncio.run(run())
        self.assertEqual(calls, 1)
        self.assertEqual(error["status"], 403)

    def test_dns_error_is_classified_for_diagnostics(self):
        request = httpx.Request("GET", "https://opendata.trudvsem.ru")
        error = httpx.ConnectError("dns failed", request=request)
        error.__cause__ = socket.gaierror("name not known")
        self.assertEqual(request_failure_kind(error), "dns_error")
