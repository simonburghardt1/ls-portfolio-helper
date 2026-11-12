"""add_ism_mfg_report_html

Revision ID: 70f75fe0cca1
Revises: 49eee1432a5e
Create Date: 2026-11-12 12:07:11.293369

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '70f75fe0cca1'
down_revision: Union[str, Sequence[str], None] = '49eee1432a5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('ism_mfg_report', sa.Column('report_html', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('ism_mfg_report', 'report_html')
