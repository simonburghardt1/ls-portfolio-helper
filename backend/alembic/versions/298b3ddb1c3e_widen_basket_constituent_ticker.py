"""widen_basket_constituent_ticker

Revision ID: 298b3ddb1c3e
Revises: e5a9c3f7d1b2
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '298b3ddb1c3e'
down_revision: Union[str, Sequence[str], None] = 'e5a9c3f7d1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # varchar(10) was too narrow for real yfinance crypto tickers, e.g. "HYPE32196-USD"
    # (13 chars) — a Yahoo Finance disambiguation suffix on some coin symbols.
    op.alter_column(
        'basket_constituent', 'ticker',
        existing_type=sa.String(length=10),
        type_=sa.String(length=20),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'basket_constituent', 'ticker',
        existing_type=sa.String(length=20),
        type_=sa.String(length=10),
        existing_nullable=False,
    )
