"""add_basket_tables

Revision ID: e5a9c3f7d1b2
Revises: d4f8a1c6b9e2
Create Date: 2026-08-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5a9c3f7d1b2'
down_revision: Union[str, Sequence[str], None] = 'd4f8a1c6b9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'basket',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('weighting_method', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'basket_constituent',
        sa.Column('basket_id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=10), nullable=False),
        sa.Column('effective_date', sa.Date(), nullable=False),
        sa.Column('weight', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['basket_id'], ['basket.id']),
        sa.PrimaryKeyConstraint('basket_id', 'ticker', 'effective_date'),
    )
    op.create_table(
        'basket_nav',
        sa.Column('basket_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('index_level', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['basket_id'], ['basket.id']),
        sa.PrimaryKeyConstraint('basket_id', 'date'),
    )


def downgrade() -> None:
    op.drop_table('basket_nav')
    op.drop_table('basket_constituent')
    op.drop_table('basket')
