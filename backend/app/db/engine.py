"""PostgreSQL engine ownership and the readiness probe."""

from collections.abc import Callable

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings

DatabaseProbe = Callable[[], None]


class DatabaseUnavailableError(Exception):
    """The configured database failed a bounded readiness probe."""


def create_database_engine(settings: Settings, *, database_url: str | None = None) -> Engine:
    """Construct a lazy bounded pool without connecting at application startup."""

    return create_engine(
        database_url or settings.database_url.get_secret_value(),
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


_PAYMENT_ROLE_CONTRACT = text(
    """
    SELECT current_user AS principal,
           role.rolsuper AS is_superuser,
           pg_has_role(current_user, 'glidelingo_app', 'MEMBER') AS is_app_member,
           pg_has_role(
             current_user, 'glidelingo_marketplace_payment_worker', 'MEMBER'
           ) AS is_payment_member,
           has_table_privilege(
             current_user, 'marketplace_booking_transition_operation', 'INSERT'
           ) AS can_insert_transition,
           has_table_privilege(
             current_user, 'marketplace_money_operation', 'INSERT'
           ) AS can_insert_money,
           has_table_privilege(
             current_user, 'marketplace_money_ledger', 'INSERT'
           ) AS can_insert_ledger,
           has_function_privilege(
             current_user,
             'marketplace_confirm_booking_payment(uuid,text,text,timestamptz,text,text,integer,text)',
             'EXECUTE'
           ) AS can_confirm_payment
    FROM pg_roles AS role WHERE role.rolname = current_user
    """
)


def create_database_probe(engine: Engine, *, payment_engine: Engine | None = None) -> DatabaseProbe:
    def probe() -> None:
        try:
            with engine.connect() as connection:
                result = connection.execute(text("SELECT 1")).scalar_one()
                app_contract = (
                    connection.execute(_PAYMENT_ROLE_CONTRACT).mappings().one()
                    if payment_engine is not None
                    else None
                )
            payment_contract = None
            if payment_engine is not None:
                with payment_engine.connect() as connection:
                    payment_contract = connection.execute(_PAYMENT_ROLE_CONTRACT).mappings().one()
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError from error

        if result != 1:
            raise DatabaseUnavailableError
        if app_contract is None or payment_contract is None:
            return
        app_forbidden = any(
            bool(app_contract[key])
            for key in (
                "is_superuser",
                "is_payment_member",
                "can_insert_transition",
                "can_insert_money",
                "can_insert_ledger",
                "can_confirm_payment",
            )
        )
        payment_required = all(
            bool(payment_contract[key])
            for key in (
                "is_app_member",
                "is_payment_member",
                "can_insert_transition",
                "can_insert_money",
                "can_insert_ledger",
                "can_confirm_payment",
            )
        )
        if (
            app_forbidden
            or bool(payment_contract["is_superuser"])
            or not bool(app_contract["is_app_member"])
            or not payment_required
            or app_contract["principal"] == payment_contract["principal"]
        ):
            raise DatabaseUnavailableError

    return probe
