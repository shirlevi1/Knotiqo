# Knotiqo on Windows

Run the built Knotiqo website locally with Django and Waitress at
`http://127.0.0.1:8765/`. The frontend and API use the same origin. The
launcher uses the existing PostgreSQL database and private media configuration.

## One-time setup

From the repository root in PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
Push-Location .\frontend
npm ci
npm run build
Pop-Location
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\backend\Start-Knotiqo.ps1 -CreateShortcut
```

Use `.\.venv\Scripts\python.exe` for the install command if your project
virtualenv is in the repository root. Keep the database connection in your
existing private `backend/.env`. If the launcher reports unapplied migrations,
review the plan against the intended database before applying any migrations:

```powershell
Push-Location .\backend
.\.venv\Scripts\python.exe manage.py migrate --plan
# After reviewing the plan and backing up the database, if needed:
.\.venv\Scripts\python.exe manage.py migrate
Pop-Location
```

The launcher checks the schema on startup and does not change it. Re-run
`npm run build` from `frontend` after frontend changes. Development commands
`npm run dev` and `python manage.py runserver` remain available.

## Launch and shutdown

- Double-click **Knotiqo** on the desktop. A second launch reuses the existing
  server and opens another browser tab or window.
- Double-click **Stop Knotiqo** to stop the server gracefully. Closing the
  browser leaves the server running.
- From PowerShell, you can run `.\backend\Start-Knotiqo.ps1` to start, or add
  `-Stop` to stop. Re-create the shortcuts if the repository moves.

## Troubleshooting

- **PostgreSQL unavailable:** Open Windows Services, start the PostgreSQL
  service, and verify the connection settings in `backend/.env`.
- **Missing build:** Run `npm ci` and `npm run build` in `frontend`.
- **Port 8765 in use:** Close the application using that port, then retry.
  The launcher leaves unrelated processes alone.
- **Other startup errors:** Check `backend/.local-launcher/server.log`.
- Start by signing in at the launcher URL. The launcher keeps a separate
  session cookie from the development server.

The launcher listens only on IPv4 loopback. It uses local HTTP and is intended
for use from this Windows machine. Keep `backend/.env`, private media and
`backend/.local-launcher/` private. Vite's `frontend/dist/` contains only the
public build and is ignored by Git. Uploaded files remain behind the existing
authenticated API and should never be placed under `frontend/public/`.
