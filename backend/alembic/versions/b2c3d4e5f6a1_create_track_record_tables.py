"""create track record tables

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a1"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_positions",
        sa.Column("id",           sa.Integer(),               nullable=False, autoincrement=True),
        sa.Column("ticker",       sa.String(20),              nullable=False),
        sa.Column("company_name", sa.String(200),             nullable=True),
        sa.Column("entry_date",   sa.Date(),                  nullable=False),
        sa.Column("side",         sa.String(10),              nullable=False),
        sa.Column("shares",       sa.Float(),                 nullable=False),
        sa.Column("avg_price_in", sa.Float(),                 nullable=False),
        sa.Column("stop",         sa.Float(),                 nullable=True),
        sa.Column("target",       sa.Float(),                 nullable=True),
        sa.Column("notes",        sa.String(500),             nullable=True),
        sa.Column("created_at",   sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at",   sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_live_positions_ticker", "live_positions", ["ticker"])

    op.create_table(
        "realized_trades",
        sa.Column("id",              sa.Integer(),               nullable=False, autoincrement=True),
        sa.Column("ticker",          sa.String(20),              nullable=False),
        sa.Column("company_name",    sa.String(200),             nullable=True),
        sa.Column("side",            sa.String(10),              nullable=False),
        sa.Column("shares",          sa.Float(),                 nullable=False),
        sa.Column("avg_entry_price", sa.Float(),                 nullable=False),
        sa.Column("avg_exit_price",  sa.Float(),                 nullable=False),
        sa.Column("entry_date",      sa.Date(),                  nullable=False),
        sa.Column("exit_date",       sa.Date(),                  nullable=False),
        sa.Column("pnl_dollar",      sa.Float(),                 nullable=False),
        sa.Column("pnl_pct",         sa.Float(),                 nullable=False),
        sa.Column("win_score",       sa.Integer(),               nullable=False),
        sa.Column("comment",         sa.String(1000),            nullable=True),
        sa.Column("created_at",      sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_realized_trades_exit_date", "realized_trades", ["exit_date"])
    op.create_index("ix_realized_trades_ticker",    "realized_trades", ["ticker"])

    op.create_table(
        "equity_entries",
        sa.Column("id",              sa.Integer(),               nullable=False, autoincrement=True),
        sa.Column("date",            sa.Date(),                  nullable=False),
        sa.Column("unrealized_pnl",  sa.Float(),                 nullable=False, server_default="0"),
        sa.Column("fees",            sa.Float(),                 nullable=False, server_default="0"),
        sa.Column("deposit",         sa.Float(),                 nullable=False, server_default="0"),
        sa.Column("withdrawal",      sa.Float(),                 nullable=False, server_default="0"),
        sa.Column("portfolio_value", sa.Float(),                 nullable=False),
        sa.Column("created_at",      sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("date", name="uq_equity_entries_date"),
    )
    op.create_index("ix_equity_entries_date", "equity_entries", ["date"])


def downgrade() -> None:
    op.drop_index("ix_equity_entries_date",       table_name="equity_entries")
    op.drop_table("equity_entries")
    op.drop_index("ix_realized_trades_ticker",    table_name="realized_trades")
    op.drop_index("ix_realized_trades_exit_date", table_name="realized_trades")
    op.drop_table("realized_trades")
    op.drop_index("ix_live_positions_ticker",     table_name="live_positions")
    op.drop_table("live_positions")
