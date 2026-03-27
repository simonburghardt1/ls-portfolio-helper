"""create cot data table

Revision ID: a1b2c3d4e5f6
Revises: 7f3e2a1b4c9d
Create Date: 2026-03-27
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "7f3e2a1b4c9d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cot_data",
        sa.Column("date",          sa.Date(),       nullable=False),
        sa.Column("contract",      sa.String(50),   nullable=False),
        sa.Column("asset_class",   sa.String(30),   nullable=True),
        sa.Column("long_pos",      sa.Integer(),    nullable=True),
        sa.Column("short_pos",     sa.Integer(),    nullable=True),
        sa.Column("open_interest", sa.Integer(),    nullable=True),
        sa.PrimaryKeyConstraint("date", "contract"),
    )
    op.create_index("ix_cot_data_date",     "cot_data", ["date"])
    op.create_index("ix_cot_data_contract", "cot_data", ["contract"])


def downgrade() -> None:
    op.drop_index("ix_cot_data_contract", table_name="cot_data")
    op.drop_index("ix_cot_data_date",     table_name="cot_data")
    op.drop_table("cot_data")
