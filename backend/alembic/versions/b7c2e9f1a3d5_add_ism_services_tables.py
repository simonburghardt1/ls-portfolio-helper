"""add_ism_services_tables

Revision ID: b7c2e9f1a3d5
Revises: f4e3d2c1b0a9
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c2e9f1a3d5'
down_revision: Union[str, Sequence[str], None] = 'f4e3d2c1b0a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ism_svc_report',
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('pmi', sa.Float(), nullable=True),
        sa.Column('business_activity', sa.Float(), nullable=True),
        sa.Column('new_orders', sa.Float(), nullable=True),
        sa.Column('employment', sa.Float(), nullable=True),
        sa.Column('supplier_deliveries', sa.Float(), nullable=True),
        sa.Column('inventories', sa.Float(), nullable=True),
        sa.Column('prices', sa.Float(), nullable=True),
        sa.Column('backlog_of_orders', sa.Float(), nullable=True),
        sa.Column('new_export_orders', sa.Float(), nullable=True),
        sa.Column('imports', sa.Float(), nullable=True),
        sa.Column('inventory_sentiment', sa.Float(), nullable=True),
        sa.Column('source_url', sa.String(length=500), nullable=True),
        sa.Column('scraped_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('date'),
    )
    op.create_table(
        'ism_svc_industry_rank',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('component', sa.String(length=50), nullable=False),
        sa.Column('industry', sa.String(length=120), nullable=False),
        sa.Column('score', sa.SmallInteger(), nullable=False),
        sa.ForeignKeyConstraint(['date'], ['ism_svc_report.date']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date', 'component', 'industry', name='uq_ism_svc_rank'),
    )
    op.create_table(
        'ism_svc_comment',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('industry', sa.String(length=120), nullable=False),
        sa.Column('comment', sa.String(length=2000), nullable=False),
        sa.ForeignKeyConstraint(['date'], ['ism_svc_report.date']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date', 'industry', name='uq_ism_svc_comment'),
    )


def downgrade() -> None:
    op.drop_table('ism_svc_comment')
    op.drop_table('ism_svc_industry_rank')
    op.drop_table('ism_svc_report')
