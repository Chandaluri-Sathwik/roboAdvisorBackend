# FinGuide API

FastAPI backend for the robo-advisor simulation. The API uses PostgreSQL and deterministic services for risk profiling, allocation, goal projections and rebalance previews.

## Local setup

1. Copy `.env.example` to `.env` and keep `AUTO_CREATE_SCHEMA=false`.
2. Start PostgreSQL: `docker compose up -d`.
3. Create and activate a virtual environment.
4. Install dependencies: `python -m pip install -r requirements.txt`.
5. Apply the schema: `python -m alembic upgrade head`.
6. Start the API: `python -m uvicorn app.main:app --reload`.

Interactive documentation is available at `http://127.0.0.1:8000/docs`.

`AUTO_CREATE_SCHEMA=true` is intended only for a short-lived local experiment. The tracked Alembic migration is the normal way to create the PostgreSQL schema.
