"""add_ism_svc_report_html

Revision ID: 8c1d4e2f9a30
Revises: 70f75fe0cca1
Create Date: 2026-11-12 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8c1d4e2f9a30'
down_revision: Union[str, Sequence[str], None] = '70f75fe0cca1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('ism_svc_report', sa.Column('report_html', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('ism_svc_report', 'report_html')
