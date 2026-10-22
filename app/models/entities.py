import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    profile: Mapped["FinancialProfile | None"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class FinancialProfile(Base):
    __tablename__ = "financial_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    monthly_income: Mapped[float] = mapped_column(Float)
    monthly_expenses: Mapped[float] = mapped_column(Float)
    emergency_fund: Mapped[float] = mapped_column(Float)
    monthly_debt_payment: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    user: Mapped[User] = relationship(back_populates="profile")
    assessments: Mapped[list["RiskAssessment"]] = relationship(back_populates="profile", cascade="all, delete-orphan")


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    profile_id: Mapped[str] = mapped_column(ForeignKey("financial_profiles.id"), index=True)
    willingness_score: Mapped[int] = mapped_column(Integer)
    capacity_score: Mapped[int] = mapped_column(Integer)
    horizon_score: Mapped[int] = mapped_column(Integer)
    total_score: Mapped[int] = mapped_column(Integer)
    risk_profile: Mapped[str] = mapped_column(String(30))
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    profile: Mapped[FinancialProfile] = relationship(back_populates="assessments")


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    goal_type: Mapped[str] = mapped_column(String(50))
    target_amount: Mapped[float] = mapped_column(Float)
    horizon_years: Mapped[int] = mapped_column(Integer)
    initial_investment: Mapped[float] = mapped_column(Float, default=0)
    monthly_contribution: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    user: Mapped[User] = relationship(back_populates="goals")
    portfolio: Mapped["Portfolio | None"] = relationship(back_populates="goal", uselist=False, cascade="all, delete-orphan")


class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    goal_id: Mapped[str] = mapped_column(ForeignKey("goals.id"), unique=True, index=True)
    risk_profile: Mapped[str] = mapped_column(String(30))
    current_value: Mapped[float] = mapped_column(Float)
    target_allocation: Mapped[dict[str, int]] = mapped_column(JSON)
    holdings: Mapped[dict[str, float]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    goal: Mapped[Goal] = relationship(back_populates="portfolio")
    snapshots: Mapped[list["PortfolioSnapshot"]] = relationship(back_populates="portfolio", cascade="all, delete-orphan")
    rebalance_proposals: Mapped[list["RebalanceProposal"]] = relationship(back_populates="portfolio", cascade="all, delete-orphan")


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id"), index=True)
    total_value: Mapped[float] = mapped_column(Float)
    holdings: Mapped[dict[str, float]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    portfolio: Mapped[Portfolio] = relationship(back_populates="snapshots")


class RebalanceProposal(Base):
    __tablename__ = "rebalance_proposals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id"), index=True)
    trades: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30), default="previewed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    portfolio: Mapped[Portfolio] = relationship(back_populates="rebalance_proposals")
