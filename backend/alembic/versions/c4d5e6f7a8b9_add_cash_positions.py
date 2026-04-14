"""add cash positions table

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a1
Create Date: 2026-04-13
"""
from alembic import op
import sqlalchemy as sa

revision      = "c4d5e6f7a8b9"
down_revision = "b2c3d4e5f6a1"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "cash_positions",
        sa.Column("id",             sa.Integer(),               nullable=False, autoincrement=True),
        sa.Column("currency",       sa.String(10),              nullable=False),
        sa.Column("amount",         sa.Float(),                 nullable=False),
        sa.Column("rate_at_import", sa.Float(),                 nullable=True),
        sa.Column("updated_at",     sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("currency", name="uq_cash_positions_currency"),
    )
    op.create_index("ix_cash_positions_currency", "cash_positions", ["currency"])


def downgrade() -> None:
    op.drop_index("ix_cash_positions_currency", table_name="cash_positions")
    op.drop_table("cash_positions")
