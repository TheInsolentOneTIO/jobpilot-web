import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import app.main as main
from app.network_diagnostic import run_diagnostic


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        main.diagnostic_last_started = 0
        self.client = TestClient(main.app)

    def test_disabled_and_invalid_secret_are_hidden(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(self.client.post("/api/internal/source-diagnostic").status_code, 404)
        with patch.dict("os.environ", {"SOURCE_DIAGNOSTIC_SECRET": "test-secret"}):
            self.assertEqual(self.client.post("/api/internal/source-diagnostic", headers={"X-Diagnostic-Secret": "wrong"}).status_code, 404)
        self.assertNotIn("/api/internal/source-diagnostic", self.client.get("/openapi.json").json()["paths"])

    def test_authenticated_diagnostic_and_rate_limit(self):
        with patch.dict("os.environ", {"SOURCE_DIAGNOSTIC_SECRET": "test-secret"}), patch.object(main, "run_diagnostic", new=AsyncMock(return_value={"results": []})) as run:
            response = self.client.post("/api/internal/source-diagnostic", headers={"X-Diagnostic-Secret": "test-secret"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(self.client.post("/api/internal/source-diagnostic", headers={"X-Diagnostic-Secret": "test-secret"}).status_code, 429)
            self.assertEqual(run.await_count, 1)

    def test_compares_both_sizes_and_network_modes(self):
        import asyncio
        with patch("app.network_diagnostic.dns_check", new=AsyncMock(return_value={"status": "ok"})), patch("app.network_diagnostic.probe", new=AsyncMock(side_effect=lambda limit, configured: {"limit": limit, "configured": configured})) as probe:
            result = asyncio.run(run_diagnostic())
        self.assertEqual(probe.await_count, 4)
        self.assertEqual([(r["limit"], r["configured"]) for r in result["results"]], [(1, True), (100, True), (1, False), (100, False)])
