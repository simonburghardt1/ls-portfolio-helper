# Setup Guide

Steps to get this project running on a fresh machine (Windows).

## Prerequisites

Install these system-wide (not into the repo folder — location doesn't matter, run from anywhere):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Docker Desktop also needs to be installed separately (not via winget in this guide — get it from docker.com).

`uv` is optional but recommended by BMAD (see step 4) — it manages Python interpreters/deps for BMAD's scripts without a manual venv. It installs to `C:\Users\<you>\.local\bin`.

### Windows gotchas

- **New terminal required after each install.** PATH changes from `winget` installs don't apply to already-open terminals — close and reopen after installing Node/Python before checking `--version`.
- **winget install may silently skip PATH.** If `python --version` still fails after reopening a terminal, check where it actually landed (`C:\Users\<you>\AppData\Local\Programs\Python\Python312\`) and add it + its `Scripts` subfolder to your user PATH manually:
  ```powershell
  $pyDir = "$env:LOCALAPPDATA\Programs\Python\Python312"
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  [Environment]::SetEnvironmentVariable("Path", "$currentPath;$pyDir;$pyDir\Scripts", "User")
  ```
- **npm blocked by execution policy.** If `npm --version` errors with "running scripts is disabled on this system," run:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

## 1. Database (Docker)

```powershell
docker compose up -d
```

This starts Postgres 16 in a container (`hello_stack_db`) with a fresh, empty database. The `postgres_data` volume is local to this machine — it does **not** carry your data over from another computer.

### Bringing data over from another machine

On the **old machine**:
```bash
docker exec -t hello_stack_db pg_dump -U hello_user -F c -f /tmp/hello_stack.dump hello_stack
docker cp hello_stack_db:/tmp/hello_stack.dump ./hello_stack.dump
```
Transfer `hello_stack.dump` to the new machine (USB/cloud/etc. — don't commit it to git, it contains real data).

On the **new machine** (after `docker compose up -d` here):
```powershell
docker cp "C:\path\to\hello_stack.dump" hello_stack_db:/tmp/hello_stack.dump
docker exec -t hello_stack_db pg_restore -U hello_user -d hello_stack --clean --if-exists /tmp/hello_stack.dump
```

## 2. Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env` (gitignored, not in the repo — recreate manually):

```
FRED_API_KEY=<your key>
FRONTEND_ORIGIN=http://localhost:3000

# Database
DATABASE_URL=postgresql://hello_user:hello_pass@localhost:5432/hello_stack

# Auth (JWT)
SECRET_KEY=<a long random string>
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

Check the restored/fresh database is in sync with the migration files:
```powershell
alembic current
alembic heads
```
They should match. If `alembic upgrade head` complains about multiple heads, use `alembic upgrade heads` (plural) instead — this repo's migration history currently has two unmerged heads (`f4e3d2c1b0a9` and `c4d5e6f7a8b9`).

Run the server:
```powershell
uvicorn main:app --reload --port 8000
```
Verify at `http://localhost:8000/api/health` → `{"ok": true}`.

## 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```
Verify at `http://localhost:3000`.

## 4. BMAD agent framework

This repo uses [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) for agent workflows, installed into a local `_bmad/` folder that's gitignored (not portable via git). Reinstall on a new machine with:

```powershell
npx bmad-method install
```

Run it from the repo root; it's interactive and will ask which modules/agents to wire in. Requires Node 20+ (already covered above).
