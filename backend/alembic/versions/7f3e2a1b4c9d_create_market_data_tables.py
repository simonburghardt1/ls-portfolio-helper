"""create market data tables

Revision ID: 7f3e2a1b4c9d
Revises: c3a81f902e14
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = "7f3e2a1b4c9d"
down_revision = "c3a81f902e14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "market_prices",
        sa.Column("date",   sa.Date(),       nullable=False),
        sa.Column("ticker", sa.String(10),   nullable=False),
        sa.Column("close",  sa.Float(),      nullable=True),
        sa.PrimaryKeyConstraint("date", "ticker"),
    )
    op.create_index("ix_market_prices_date", "market_prices", ["date"])

    op.create_table(
        "market_regime",
        sa.Column("date",          sa.Date(),       nullable=False),
        sa.Column("spy_price",     sa.Float(),      nullable=True),
        sa.Column("ema21",         sa.Float(),      nullable=True),
        sa.Column("sma20",         sa.Float(),      nullable=True),
        sa.Column("regime",        sa.String(10),   nullable=True),
        sa.Column("composite",     sa.Float(),      nullable=True),
        sa.Column("score_bmsb",    sa.Float(),      nullable=True),
        sa.Column("score_breadth", sa.Float(),      nullable=True),
        sa.Column("score_vix",     sa.Float(),      nullable=True),
        sa.Column("score_credit",  sa.Float(),      nullable=True),
        sa.PrimaryKeyConstraint("date"),
    )
    op.create_index("ix_market_regime_date", "market_regime", ["date"])


def downgrade() -> None:
    op.drop_index("ix_market_regime_date",  table_name="market_regime")
    op.drop_table("market_regime")
    op.drop_index("ix_market_prices_date",  table_name="market_prices")
    op.drop_table("market_prices")
