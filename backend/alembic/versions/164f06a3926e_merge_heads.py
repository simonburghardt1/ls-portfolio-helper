"""merge_heads

Revision ID: 164f06a3926e
Revises: 298b3ddb1c3e, c4d5e6f7a8b9
Create Date: 2026-09-17 21:19:27.827301

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '164f06a3926e'
down_revision: Union[str, Sequence[str], None] = ('298b3ddb1c3e', 'c4d5e6f7a8b9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
