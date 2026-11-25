"""Start and stop the Windows-only Knotiqo localhost server."""

import argparse
import contextlib
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import webbrowser


BACKEND = Path(__file__).resolve().parent
BUILD = BACKEND.parent / "frontend" / "dist"
RUNTIME = BACKEND / ".local-launcher"
HOST = "127.0.0.1"
PORT = 8765
ORIGIN = f"http://{HOST}:{PORT}/"
DB_ERROR = "PostgreSQL is unavailable. Start its Windows service and check DATABASE settings in backend/.env (DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD)."


class StartupError(Exception):
    pass


@contextlib.contextmanager
def locked(path, timeout):
    import msvcrt

    with path.open("a+b") as handle:
        deadline = time.monotonic() + timeout
        while True:
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                if time.monotonic() >= deadline:
                    raise StartupError("Another Knotiqo operation is still running. Try again in a moment.") from None
                time.sleep(0.15)
            else:
                break
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def instance_id():
    try:
        value = (RUNTIME / "instance").read_text(encoding="ascii").strip()
    except (FileNotFoundError, UnicodeError):
        return None
    return value if re.fullmatch(r"[0-9a-f]{32}", value) else None


def probe():
    """Connect directly to loopback, without proxies or HTTP redirects."""
    connection = HTTPConnection(HOST, PORT, timeout=1)
    try:
        connection.request("GET", "/_knotiqo/ready/", headers={"Connection": "close"})
        response = connection.getresponse()
        try:
            data = json.loads(response.read(1024))
        except (ValueError, UnicodeError):
            data = None
        return response.status, data if isinstance(data, dict) else {}
    except (OSError, HTTPException):
        return None, {}
    finally:
        connection.close()


def open_site(no_browser):
    if not no_browser and not webbrowser.open(ORIGIN):
        raise StartupError(f"Knotiqo is running. Open {ORIGIN} in your browser.")


def launch(no_browser):
    with locked(RUNTIME / "launcher.lock", timeout=45):
        current = instance_id()
        status, data = probe()
        if status is not None:
            if current is None or data.get("instance") != current:
                raise StartupError(f"Port {PORT} is already in use by another server. Free that port and try again.")
            if status != 200 or data.get("ready") is not True:
                raise StartupError(DB_ERROR)
        else:
            if not (BUILD / "index.html").is_file() or not (BUILD / "assets").is_dir():
                raise StartupError("The frontend build is missing. Run npm ci and npm run build in the frontend folder.")
            secret_file = RUNTIME / "secret-key"
            if not secret_file.exists():
                secret_file.write_text(secrets.token_urlsafe(64), encoding="ascii")
            instance = secrets.token_hex(16)
            (RUNTIME / "instance").write_text(instance, encoding="ascii")
            error_file = RUNTIME / "startup-error.txt"
            error_file.unlink(missing_ok=True)
            with (RUNTIME / "server.log").open("w", encoding="utf-8") as log:
                worker = subprocess.Popen(
                    [sys.executable, str(Path(__file__).resolve()), "serve", instance],
                    cwd=BACKEND, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
                )
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                status, data = probe()
                if status == 200 and data.get("instance") == instance and data.get("ready") is True:
                    break
                if worker.poll() is not None:
                    message = error_file.read_text(encoding="utf-8") if error_file.exists() else "Check backend/.local-launcher/server.log."
                    raise StartupError(message)
                time.sleep(0.2)
            else:
                (RUNTIME / f"stop-{instance}").touch()
                raise StartupError("Knotiqo did not become ready. Check PostgreSQL and backend/.local-launcher/server.log.")
    open_site(no_browser)


def stop():
    with locked(RUNTIME / "launcher.lock", timeout=45):
        current = instance_id()
        if current is None:
            return
        signal = RUNTIME / f"stop-{current}"
        signal.touch()
        # The worker owns this lock across startup, serving and shutdown.
        # Waiting on the lock avoids relying on reusable Windows process IDs.
        with locked(RUNTIME / "server.lock", timeout=15):
            (RUNTIME / "instance").unlink(missing_ok=True)
        signal.unlink(missing_ok=True)


def serve(instance):
    import _thread
    import threading

    signal = RUNTIME / f"stop-{instance}"
    with locked(RUNTIME / "server.lock", timeout=2):
        if instance_id() != instance or signal.exists():
            return
        try:
            from waitress import create_server
        except ImportError:
            raise StartupError("Waitress is missing. Install backend/requirements.txt in the project virtual environment.") from None

        os.environ["DJANGO_SETTINGS_MODULE"] = "config.local_settings"
        os.environ["KNOTIQO_LOCAL_SECRET"] = (RUNTIME / "secret-key").read_text(encoding="ascii")
        os.environ["KNOTIQO_LOCAL_INSTANCE"] = instance
        try:
            from django.core.wsgi import get_wsgi_application

            application = get_wsgi_application()
        except (KeyError, ImportError) as error:
            raise StartupError("Django could not load. Install backend/requirements.txt and check the project backend/.env.") from error

        from django.db import DatabaseError, connection
        from django.db.migrations.executor import MigrationExecutor

        try:
            executor = MigrationExecutor(connection)
            pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        except DatabaseError:
            raise StartupError(DB_ERROR) from None
        finally:
            connection.close()
        if pending:
            raise StartupError("Database migrations are pending. Review and run python manage.py migrate manually, then retry.")
        if signal.exists():
            return
        try:
            server = create_server(
                application, host=HOST, port=PORT, threads=4,
                clear_untrusted_proxy_headers=True, max_request_body_size=8 * 1024 * 1024,
            )
        except OSError:
            raise StartupError(f"Knotiqo could not bind to {HOST}:{PORT}. Check whether that port is in use.") from None

        def wait_for_stop():
            while not signal.exists():
                time.sleep(0.2)
            _thread.interrupt_main()

        watcher = threading.Thread(target=wait_for_stop, daemon=True)
        watcher.start()
        try:
            server.run()
        finally:
            server.close()
            signal.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("open", "stop", "serve"), nargs="?", default="open")
    parser.add_argument("instance", nargs="?")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("This launcher requires Windows.")
    if args.action == "serve" and not re.fullmatch(r"[0-9a-f]{32}", args.instance or ""):
        parser.error("Invalid server instance ID.")
    try:
        RUNTIME.mkdir(exist_ok=True)
        if args.action == "serve":
            serve(args.instance)
        elif args.action == "stop":
            stop()
        else:
            launch(args.no_browser)
    except Exception as error:
        message = str(error) if isinstance(error, StartupError) else (
            "Knotiqo could not start or stop. Check project permissions and backend/.local-launcher/server.log."
        )
        if args.action == "serve":
            (RUNTIME / "startup-error.txt").write_text(message, encoding="utf-8")
        print(message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
