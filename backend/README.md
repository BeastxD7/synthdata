# SynthData Backend

FastAPI backend for the SynthData synthetic NLP dataset generator. Runs on **port 8000**.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | ≥ 3.13 | [python.org](https://python.org) or `brew install python@3.13` |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| PostgreSQL | ≥ 14 | `brew install postgresql@16` or Docker (see below) |

---

## Quick Start

### 1. Start PostgreSQL

**Option A — Homebrew (local)**
```bash
brew services start postgresql@16
createdb synthdata
```

**Option B — Docker**
```bash
docker run -d \
  --name synthdata-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=synthdata \
  -p 5432:5432 \
  postgres:16-alpine
```

### 2. Set up environment

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
# Database — matches the PostgreSQL setup above
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/synthdata

# JWT — generate a strong random key for production
SECRET_KEY=change-me-to-a-random-64-char-string-in-production

# Credential encryption — generate a Fernet key
ENCRYPTION_KEY=change-me-to-a-fernet-key-in-production
```

**Generate secrets:**
```bash
# SECRET_KEY
python -c "import secrets; print(secrets.token_hex(32))"

# ENCRYPTION_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3. Install dependencies

```bash
cd backend
uv sync
```

This installs all dependencies including the local `synthdata-engine` package from `../engine`.

### 4. Run database migrations

```bash
uv run alembic upgrade head
```

This creates all tables (users, jobs, credit_transactions, credit_settings).

### 5. Start the server

```bash
uv run uvicorn app.main:app --reload --port 8000
```

The server starts on **http://localhost:8000**.

---

## API Docs

| URL | Description |
|-----|-------------|
| http://localhost:8000/api/docs | Swagger UI (interactive) |
| http://localhost:8000/api/redoc | ReDoc |
| http://localhost:8000/health | Health check |

---

## Running Tests

```bash
cd backend

# Run all tests
uv run pytest

# Run with verbose output
uv run pytest -v

# Run a specific test file
uv run pytest tests/test_auth.py -v

# Run E2E tests only
uv run pytest tests/test_e2e.py -v
```

Tests hit a real database. Make sure PostgreSQL is running and the `DATABASE_URL` in `.env` is correct before running tests.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL async URL (`postgresql+asyncpg://...`) |
| `SECRET_KEY` | Yes | — | JWT signing key (64-char hex recommended) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `30` | Access token TTL in minutes |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | `7` | Refresh token TTL in days |
| `ENCRYPTION_KEY` | Yes | — | Fernet key for encrypting provider credentials |
| `APP_ENV` | No | `development` | `development` or `production` |
| `APP_NAME` | No | `SynthData API` | Display name in Swagger |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-separated CORS origins |
| `OUTPUTS_DIR` | No | `outputs` | Directory for generated dataset files |

---

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app, middleware, routers
│   ├── core/
│   │   ├── config.py        # Pydantic settings
│   │   └── database.py      # Async SQLAlchemy engine + session
│   ├── models/              # SQLAlchemy ORM models
│   ├── schemas/             # Pydantic request/response schemas
│   ├── routers/             # Route handlers (auth, users, jobs, credits, admin)
│   ├── services/            # Business logic (auth, jobs, credits)
│   └── utils/               # Shared helpers (errors, responses)
├── migrations/              # Alembic migrations
│   └── versions/
├── tests/                   # pytest test suite
├── outputs/                 # Generated dataset files (gitignored)
├── .env.example             # Environment variable template
├── alembic.ini              # Alembic config
└── pyproject.toml           # Project metadata + dependencies
```

---

## Common Issues

**`asyncpg.exceptions.InvalidCatalogNameError: database "synthdata" does not exist`**
→ Run `createdb synthdata` (Homebrew) or create the database via Docker.

**`alembic.util.exc.CommandError: Can't locate revision identified by ...`**
→ Run `uv run alembic upgrade head` to apply all pending migrations.

**`ModuleNotFoundError: No module named 'synthdata_engine'`**
→ Run `uv sync` from the `backend/` directory — this installs the local engine package.

**Port 8000 already in use**
→ Kill the existing process: `lsof -ti:8000 | xargs kill -9`
