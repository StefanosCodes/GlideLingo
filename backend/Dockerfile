FROM python:3.13-slim-trixie AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/app ./app
RUN uv sync --locked --no-dev --no-editable

FROM python:3.13-slim-trixie AS runtime

ENV PATH="/app/backend/.venv/bin:$PATH" \
    PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend

RUN groupadd --system glidelingo \
    && useradd --system --gid glidelingo --home-dir /app/backend glidelingo

COPY --from=builder --chown=glidelingo:glidelingo /app/backend/.venv /app/backend/.venv
COPY --chown=glidelingo:glidelingo content /app/content

USER glidelingo
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
