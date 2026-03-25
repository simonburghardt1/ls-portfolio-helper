"""create portfolios table

Revision ID: c3a81f902e14
Revises: 401f2a405362
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = "c3a81f902e14"
down_revision = "401f2a405362"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portfolios",
        sa.Column("id",         sa.Integer(),                  nullable=False),
        sa.Column("name",       sa.String(120),                nullable=False),
        sa.Column("positions",  sa.JSON(),                     nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),    nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),    nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_portfolios_id", "portfolios", ["id"])


def downgrade() -> None:
    op.drop_index("ix_portfolios_id", table_name="portfolios")
    op.drop_table("portfolios")
