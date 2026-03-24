"""widen macro_cache series_id from 50 to 100

Revision ID: 401f2a405362
Revises: ddad14618553
Create Date: 2026-03-24

Reason: composite cache keys for industry+component pairs
(e.g. NFIB_IND_1__NFIB_CREDIT_EXPECT) can approach the old 50-char limit.
VARCHAR(100) gives headroom without any storage cost on short keys.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "401f2a405362"
down_revision: Union[str, Sequence[str], None] = "ddad14618553"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "macro_cache", "series_id",
        existing_type=sa.String(length=50),
        type_=sa.String(length=100),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "macro_cache", "series_id",
        existing_type=sa.String(length=100),
        type_=sa.String(length=50),
        existing_nullable=False,
    )
