"""add_high_beta_momentum_tables

Revision ID: d4f8a1c6b9e2
Revises: b7c2e9f1a3d5
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f8a1c6b9e2'
down_revision: Union[str, Sequence[str], None] = 'b7c2e9f1a3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'hbm_index_level',
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('index_level', sa.Float(), nullable=False),
        sa.Column('daily_return', sa.Float(), nullable=True),
        sa.Column('num_holdings_active', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('date'),
    )
    op.create_table(
        'hbm_holding',
        sa.Column('rebalance_date', sa.Date(), nullable=False),
        sa.Column('ticker', sa.String(length=10), nullable=False),
        sa.Column('rank', sa.Integer(), nullable=False),
        sa.Column('beta', sa.Float(), nullable=True),
        sa.Column('momentum', sa.Float(), nullable=True),
        sa.Column('z_beta', sa.Float(), nullable=True),
        sa.Column('z_momentum', sa.Float(), nullable=True),
        sa.Column('combined_score', sa.Float(), nullable=True),
        sa.Column('market_cap', sa.Float(), nullable=True),
        sa.Column('weight', sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint('rebalance_date', 'ticker'),
    )


def downgrade() -> None:
    op.drop_table('hbm_holding')
    op.drop_table('hbm_index_level')
