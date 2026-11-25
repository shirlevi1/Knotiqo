import io
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from unittest import skipUnless

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase
from openpyxl import Workbook
import requests

import local_launcher
from weddings.services import create_wedding


@skipUnless(sys.platform == "win32", "Windows launcher integration")
class LocalLauncherTests(TransactionTestCase):
    def test_waitress_serves_frontend_auth_and_excel_on_one_origin(self):
        user = get_user_model().objects.create_user(username="launcher-fixture", password="Launcher-fixture!41")
        wedding = create_wedding(user=user, name="Launcher fixture")
        with TemporaryDirectory() as directory, requests.Session() as client:
            root = Path(directory)
            runtime = root / "runtime"
            build = root / "build"
            runtime.mkdir()
            build.mkdir()
            (build / "assets").mkdir()
            (build / "index.html").write_text('<script type="module" src="/assets/example.js"></script>', encoding="utf-8")
            (build / "assets" / "example.js").write_text('console.log("fixture");', encoding="utf-8")
            (build / "private.xlsx").write_bytes(b"private")
            instance = "1" * 32
            (runtime / "instance").write_text(instance, encoding="ascii")
            (runtime / "secret-key").write_text("disposable-test-key-only", encoding="ascii")

            # The subprocess connects solely to Django's disposable test database.
            db = connection.settings_dict
            env = {**os.environ, **{
                f"DB_{key}": str(db[key]) for key in ("NAME", "USER", "PASSWORD", "HOST", "PORT")
            }}
            code = """
import os
from pathlib import Path
from waitress import create_server
import local_launcher


local_launcher.RUNTIME = Path(os.environ["TEST_RUNTIME"])

def capture_port(app, **kwargs):
    from django.conf import settings
    settings.LOCAL_BUILD = Path(os.environ["TEST_BUILD"])
    server = create_server(app, **{**kwargs, "port": 0})
    (local_launcher.RUNTIME / "port").write_text(str(server.effective_port), encoding="ascii")
    return server

import waitress
waitress.create_server = capture_port
local_launcher.serve(os.environ["TEST_INSTANCE"])
"""
            env.update(TEST_RUNTIME=str(runtime), TEST_BUILD=str(build), TEST_INSTANCE=instance)
            worker = subprocess.Popen([sys.executable, "-c", code], cwd=local_launcher.BACKEND, env=env,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                port_path = runtime / "port"
                deadline = time.monotonic() + 15
                while not port_path.exists() and worker.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.1)
                self.assertTrue(port_path.exists(), "Waitress did not publish its ephemeral test port")
                origin = "http://127.0.0.1:" + port_path.read_text(encoding="ascii")
                client.trust_env = False

                def request(method, path, **kwargs):
                    return client.request(method, origin + path, timeout=5, **kwargs)

                self.assertEqual(request("GET", "/_knotiqo/ready/").json(), {"ready": True, "instance": instance})
                for route in ("venues", "guests", "budget", "vendors"):
                    self.assertIn("/assets/example.js", request("GET", f"/#/weddings/{wedding.pk}/{route}").text)
                self.assertIn("fixture", request("GET", "/assets/example.js").text)
                self.assertEqual(request("GET", "/private.xlsx").status_code, 404)
                self.assertEqual(request("GET", "/api/missing/").status_code, 404)
                self.assertEqual(request("GET", "/", headers={"Host": "not-local.example"}).status_code, 400)

                payload = {"username": user.username, "password": "Launcher-fixture!41"}
                self.assertEqual(request("POST", "/api/auth/login/", json=payload).status_code, 403)
                self.assertEqual(request("GET", "/api/auth/csrf/").status_code, 200)
                headers = {"Origin": origin, "X-CSRFToken": client.cookies["csrftoken"]}
                self.assertEqual(request("POST", "/api/auth/login/", json=payload, headers=headers).status_code, 200)
                self.assertIn("knotiqo_local_session", client.cookies)
                self.assertEqual(request("GET", "/api/auth/me/").json()["id"], user.pk)

                prefix = f"/api/weddings/{wedding.pk}/"
                for path in ("venues/", "guests/", "budget/", "vendors/"):
                    self.assertEqual(request("GET", prefix + path).status_code, 200)
                for action in ("template", "export"):
                    download = request("GET", prefix + f"guests/{action}/")
                    self.assertEqual(download.status_code, 200)
                    self.assertIn("spreadsheetml", download.headers["Content-Type"])
                    self.assertTrue(download.content.startswith(b"PK"))

                workbook = Workbook()
                workbook.active.append(["Full name"])
                workbook.active.append(["Launcher fixture"])
                buffer = io.BytesIO()
                workbook.save(buffer)
                headers["X-CSRFToken"] = client.cookies["csrftoken"]
                response = request("POST", prefix + "guests/import/",
                                   files={"workbook": ("fixture.xlsx", buffer.getvalue())}, headers=headers)
                self.assertEqual(response.status_code, 201)
                self.assertIn("worksheets", response.json())
                self.assertEqual(request("POST", "/api/auth/logout/", headers=headers).status_code, 200)
                self.assertEqual(request("GET", "/api/auth/me/").status_code, 401)
            finally:
                (runtime / f"stop-{instance}").touch()
                try:
                    worker.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    worker.terminate()
                    worker.wait(timeout=5)

