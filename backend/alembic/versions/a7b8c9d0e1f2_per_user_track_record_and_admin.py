"""per-user Track Record + Portfolios, users.is_admin

Track Record (live_positions, realized_trades, cash_positions, equity_entries) and saved
Portfolios were single-tenant: every logged-in user saw the same rows. Each table gets an
owning user_id; all existing rows belong to the account that created them
(simon.burghardt@gmx.de), looked up by email rather than a hard-coded id. Uniqueness that was
global becomes per user (portfolio name, cash currency, equity-entry date).

users.is_admin gates the admin pages and data-maintenance endpoints; the same account is the
first admin.

Revision ID: a7b8c9d0e1f2
Revises: 8c1d4e2f9a30
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "8c1d4e2f9a30"
branch_labels = None
depends_on = None

OWNER_EMAIL = "simon.burghardt@gmx.de"
TABLES = ["live_positions", "realized_trades", "cash_positions", "equity_entries", "portfolios"]


def upgrade() -> None:
    conn = op.get_bind()

    # ── users.is_admin ──
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False))
    conn.execute(sa.text("UPDATE users SET is_admin = true WHERE email = :e"), {"e": OWNER_EMAIL})

    owner_id = conn.execute(sa.text("SELECT id FROM users WHERE email = :e"), {"e": OWNER_EMAIL}).scalar()

    # ── user_id on each per-user table ──
    for t in TABLES:
        op.add_column(t, sa.Column("user_id", sa.Integer(), nullable=True))
        has_rows = conn.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {t})")).scalar()
        if has_rows:
            if owner_id is None:
                raise RuntimeError(f"{t} has rows but owner {OWNER_EMAIL} does not exist — cannot assign them")
            conn.execute(sa.text(f"UPDATE {t} SET user_id = :u WHERE user_id IS NULL"), {"u": owner_id})
        op.alter_column(t, "user_id", nullable=False)
        op.create_foreign_key(f"fk_{t}_user_id", t, "users", ["user_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{t}_user_id", t, ["user_id"])

    # ── global → per-user uniqueness ──
    op.drop_constraint("portfolios_name_key", "portfolios", type_="unique")
    op.create_unique_constraint("uq_portfolios_user_name", "portfolios", ["user_id", "name"])
    op.drop_constraint("uq_cash_positions_currency", "cash_positions", type_="unique")
    op.create_unique_constraint("uq_cash_positions_user_currency", "cash_positions", ["user_id", "currency"])
    op.drop_constraint("uq_equity_entries_date", "equity_entries", type_="unique")
    op.create_unique_constraint("uq_equity_entries_user_date", "equity_entries", ["user_id", "date"])


def downgrade() -> None:
    # Only safe while a single user owns all rows (otherwise the global uniques can collide).
    op.drop_constraint("uq_equity_entries_user_date", "equity_entries", type_="unique")
    op.create_unique_constraint("uq_equity_entries_date", "equity_entries", ["date"])
    op.drop_constraint("uq_cash_positions_user_currency", "cash_positions", type_="unique")
    op.create_unique_constraint("uq_cash_positions_currency", "cash_positions", ["currency"])
    op.drop_constraint("uq_portfolios_user_name", "portfolios", type_="unique")
    op.create_unique_constraint("portfolios_name_key", "portfolios", ["name"])
    for t in reversed(TABLES):
        op.drop_index(f"ix_{t}_user_id", table_name=t)
        op.drop_constraint(f"fk_{t}_user_id", t, type_="foreignkey")
        op.drop_column(t, "user_id")
    op.drop_column("users", "is_admin")
