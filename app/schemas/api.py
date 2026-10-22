from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)


class UserRead(APIModel):
    id: str
    email: EmailStr
    display_name: str
    created_at: datetime


class FinancialProfileUpsert(BaseModel):
    monthly_income: float = Field(ge=0)
    monthly_expenses: float = Field(ge=0)
    emergency_fund: float = Field(ge=0)
    monthly_debt_payment: float = Field(default=0, ge=0)


class FinancialProfileRead(FinancialProfileUpsert, APIModel):
    id: str
    user_id: str
    updated_at: datetime


class RiskAssessmentRequest(BaseModel):
    willingness_score: int = Field(ge=0, le=100)
    capacity_score: int = Field(ge=0, le=100)
    horizon_score: int = Field(ge=0, le=100)


class RiskAssessmentRead(APIModel):
    id: str
    willingness_score: int
    capacity_score: int
    horizon_score: int
    total_score: int
    risk_profile: str
    warnings: list[str]
    created_at: datetime


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal_type: str = Field(min_length=1, max_length=50)
    target_amount: float = Field(gt=0)
    horizon_years: int = Field(ge=1, le=50)
    initial_investment: float = Field(default=0, ge=0)
    monthly_contribution: float = Field(ge=0)


class GoalRead(GoalCreate, APIModel):
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime


class ProjectionRequest(BaseModel):
    initial_investment: float = Field(ge=0)
    monthly_contribution: float = Field(ge=0)
    years: int = Field(ge=1, le=50)
    target_amount: float = Field(gt=0)


class ProjectionRead(BaseModel):
    annual_return: float
    future_value: float
    total_contributions: float
    shortfall: float


class PortfolioRecommendRequest(BaseModel):
    goal_id: str
    risk_profile: str


class PortfolioRead(APIModel):
    id: str
    goal_id: str
    risk_profile: str
    current_value: float
    target_allocation: dict[str, int]
    holdings: dict[str, float]
    actual_allocation: dict[str, float]
    created_at: datetime
    updated_at: datetime


class PortfolioSnapshotRead(APIModel):
    id: str
    total_value: float
    holdings: dict[str, float]
    created_at: datetime


class MarketSimulationRequest(BaseModel):
    changes: dict[str, float] = Field(description="Decimal changes, such as {'equity': 0.12}")


class RebalanceTradeRead(BaseModel):
    asset_class: str
    action: str
    amount: float
    reason: str


class RebalancePreviewRead(BaseModel):
    portfolio_id: str
    trades: list[RebalanceTradeRead]
    is_rebalance_required: bool
