"""add_basket_regime_table

Revision ID: 49eee1432a5e
Revises: 164f06a3926e
Create Date: 2026-09-17 21:19:34.892621

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '49eee1432a5e'
down_revision: Union[str, Sequence[str], None] = '164f06a3926e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'basket_regime',
        sa.Column('basket_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('regime', sa.String(length=10), nullable=True),
        sa.Column('score01', sa.Float(), nullable=True),
        sa.Column('score_bmsb', sa.Float(), nullable=True),
        sa.Column('score_vol', sa.Float(), nullable=True),
        sa.Column('score_breadth', sa.Float(), nullable=True),
        sa.Column('score_relative_strength', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['basket_id'], ['basket.id']),
        sa.PrimaryKeyConstraint('basket_id', 'date'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('basket_regime')
