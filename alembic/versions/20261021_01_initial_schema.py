"""Create FinGuide's initial PostgreSQL schema."""

from alembic import op
import sqlalchemy as sa

revision = "20261021_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_table(
        "financial_profiles",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("monthly_income", sa.Float(), nullable=False),
        sa.Column("monthly_expenses", sa.Float(), nullable=False),
        sa.Column("emergency_fund", sa.Float(), nullable=False),
        sa.Column("monthly_debt_payment", sa.Float(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_financial_profiles_user_id", "financial_profiles", ["user_id"])
    op.create_table(
        "risk_assessments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("profile_id", sa.String(length=36), sa.ForeignKey("financial_profiles.id"), nullable=False),
        sa.Column("willingness_score", sa.Integer(), nullable=False),
        sa.Column("capacity_score", sa.Integer(), nullable=False),
        sa.Column("horizon_score", sa.Integer(), nullable=False),
        sa.Column("total_score", sa.Integer(), nullable=False),
        sa.Column("risk_profile", sa.String(length=30), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_risk_assessments_profile_id", "risk_assessments", ["profile_id"])
    op.create_table(
        "goals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("goal_type", sa.String(length=50), nullable=False),
        sa.Column("target_amount", sa.Float(), nullable=False),
        sa.Column("horizon_years", sa.Integer(), nullable=False),
        sa.Column("initial_investment", sa.Float(), nullable=False, server_default="0"),
        sa.Column("monthly_contribution", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_goals_user_id", "goals", ["user_id"])
    op.create_table(
        "portfolios",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("goal_id", sa.String(length=36), sa.ForeignKey("goals.id"), nullable=False, unique=True),
        sa.Column("risk_profile", sa.String(length=30), nullable=False),
        sa.Column("current_value", sa.Float(), nullable=False),
        sa.Column("target_allocation", sa.JSON(), nullable=False),
        sa.Column("holdings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_portfolios_goal_id", "portfolios", ["goal_id"])
    op.create_table(
        "portfolio_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("portfolio_id", sa.String(length=36), sa.ForeignKey("portfolios.id"), nullable=False),
        sa.Column("total_value", sa.Float(), nullable=False),
        sa.Column("holdings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_portfolio_snapshots_portfolio_id", "portfolio_snapshots", ["portfolio_id"])
    op.create_table(
        "rebalance_proposals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("portfolio_id", sa.String(length=36), sa.ForeignKey("portfolios.id"), nullable=False),
        sa.Column("trades", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="previewed"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rebalance_proposals_portfolio_id", "rebalance_proposals", ["portfolio_id"])


def downgrade() -> None:
    for table in ("rebalance_proposals", "portfolio_snapshots", "portfolios", "goals", "risk_assessments", "financial_profiles", "users"):
        op.drop_table(table)
