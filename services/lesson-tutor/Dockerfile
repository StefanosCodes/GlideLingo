FROM python:3.13-slim-trixie AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/tutor
COPY services/lesson-tutor/pyproject.toml services/lesson-tutor/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY services/lesson-tutor/app ./app
RUN uv sync --locked --no-dev --no-editable

FROM python:3.13-slim-trixie AS runtime
ENV PATH="/app/tutor/.venv/bin:$PATH" \
    PORT=8080 \
    GLIDELINGO_TUTOR_CONTENT_ROOT=/app/content \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1 \
    OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1
WORKDIR /app/tutor
RUN groupadd --system glidelingo && useradd --system --gid glidelingo --home-dir /app/tutor glidelingo
COPY --from=builder --chown=glidelingo:glidelingo /app/tutor/.venv /app/tutor/.venv
COPY --chown=glidelingo:glidelingo content /app/content
USER glidelingo
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
