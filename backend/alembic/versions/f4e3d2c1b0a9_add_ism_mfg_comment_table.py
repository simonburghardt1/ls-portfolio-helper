"""add_ism_mfg_comment_table

Revision ID: f4e3d2c1b0a9
Revises: ddad14618553
Create Date: 2026-04-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4e3d2c1b0a9'
down_revision: Union[str, Sequence[str], None] = 'ddad14618553'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ism_mfg_comment',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('industry', sa.String(length=120), nullable=False),
        sa.Column('comment', sa.String(length=2000), nullable=False),
        sa.ForeignKeyConstraint(['date'], ['ism_mfg_report.date']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date', 'industry', name='uq_ism_comment'),
    )


def downgrade() -> None:
    op.drop_table('ism_mfg_comment')
