"""PostgreSQL engine ownership and the readiness probe."""

from collections.abc import Callable

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings

DatabaseProbe = Callable[[], None]


class DatabaseUnavailableError(Exception):
    """The configured database failed a bounded readiness probe."""


def create_database_engine(settings: Settings) -> Engine:
    """Construct a lazy bounded pool without connecting at application startup."""

    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_timeout=settings.database_pool_timeout_seconds,
        pool_recycle=settings.database_pool_recycle_seconds,
        connect_args={
            "connect_timeout": settings.database_connect_timeout_seconds,
            "options": (
                f"-c statement_timeout={settings.database_statement_timeout_seconds * 1000}"
            ),
        },
    )


def create_database_probe(engine: Engine) -> DatabaseProbe:
    def probe() -> None:
        try:
            with engine.connect() as connection:
                result = connection.execute(text("SELECT 1")).scalar_one()
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError from error

        if result != 1:
            raise DatabaseUnavailableError

    return probe
