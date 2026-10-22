from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Goal, Portfolio, PortfolioSnapshot, RebalanceProposal
from app.schemas.api import MarketSimulationRequest, PortfolioRead, PortfolioRecommendRequest, PortfolioSnapshotRead, RebalancePreviewRead, RebalanceTradeRead
from app.services.portfolio import actual_weights, allocation_for, contribution_split, preview_rebalance
from app.services.risk import RiskProfile

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


@router.post("/recommend", response_model=PortfolioRead, status_code=status.HTTP_201_CREATED)
def recommend_portfolio(payload: PortfolioRecommendRequest, db: Session = Depends(get_db)) -> PortfolioRead:
    goal = _goal_or_404(payload.goal_id, db)
    try:
        risk_profile = RiskProfile(payload.risk_profile)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported risk profile.") from error

    allocation = allocation_for(risk_profile)
    initial_value = goal.initial_investment or goal.monthly_contribution
    holdings = contribution_split(initial_value, allocation)
    existing = db.query(Portfolio).filter(Portfolio.goal_id == goal.id).one_or_none()
    if existing:
        existing.risk_profile = risk_profile.value
        existing.current_value = initial_value
        existing.target_allocation = allocation
        existing.holdings = holdings
        portfolio = existing
    else:
        portfolio = Portfolio(goal_id=goal.id, risk_profile=risk_profile.value, current_value=initial_value, target_allocation=allocation, holdings=holdings)
        db.add(portfolio)
    db.flush()
    db.add(PortfolioSnapshot(portfolio_id=portfolio.id, total_value=initial_value, holdings=holdings))
    db.commit()
    db.refresh(portfolio)
    return _as_response(portfolio)


@router.get("/{portfolio_id}", response_model=PortfolioRead)
def get_portfolio(portfolio_id: str, db: Session = Depends(get_db)) -> PortfolioRead:
    return _as_response(_portfolio_or_404(portfolio_id, db))


@router.post("/{portfolio_id}/simulate-market", response_model=PortfolioRead)
def simulate_market(portfolio_id: str, payload: MarketSimulationRequest, db: Session = Depends(get_db)) -> PortfolioRead:
    portfolio = _portfolio_or_404(portfolio_id, db)
    updated_holdings = {
        asset_class: round(value * (1 + payload.changes.get(asset_class, 0)), 2)
        for asset_class, value in portfolio.holdings.items()
    }
    if any(value < 0 for value in updated_holdings.values()):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A market change cannot reduce a holding below zero.")
    portfolio.holdings = updated_holdings
    portfolio.current_value = round(sum(updated_holdings.values()), 2)
    db.add(PortfolioSnapshot(portfolio_id=portfolio.id, total_value=portfolio.current_value, holdings=updated_holdings))
    db.commit()
    db.refresh(portfolio)
    return _as_response(portfolio)


@router.post("/{portfolio_id}/rebalance/preview", response_model=RebalancePreviewRead)
def rebalance_preview(portfolio_id: str, db: Session = Depends(get_db)) -> RebalancePreviewRead:
    portfolio = _portfolio_or_404(portfolio_id, db)
    trades = preview_rebalance(portfolio.holdings, portfolio.target_allocation)
    trade_data = [trade.__dict__ for trade in trades]
    db.add(RebalanceProposal(portfolio_id=portfolio.id, trades=trade_data))
    db.commit()
    return RebalancePreviewRead(portfolio_id=portfolio.id, trades=[RebalanceTradeRead(**trade) for trade in trade_data], is_rebalance_required=bool(trades))


@router.post("/{portfolio_id}/rebalance/apply", response_model=PortfolioRead)
def apply_rebalance(portfolio_id: str, db: Session = Depends(get_db)) -> PortfolioRead:
    portfolio = _portfolio_or_404(portfolio_id, db)
    total_value = sum(portfolio.holdings.values())
    portfolio.holdings = contribution_split(total_value, portfolio.target_allocation)
    portfolio.current_value = total_value
    db.add(PortfolioSnapshot(portfolio_id=portfolio.id, total_value=total_value, holdings=portfolio.holdings))
    db.commit()
    db.refresh(portfolio)
    return _as_response(portfolio)


@router.get("/{portfolio_id}/history", response_model=list[PortfolioSnapshotRead])
def portfolio_history(portfolio_id: str, db: Session = Depends(get_db)) -> list[PortfolioSnapshot]:
    portfolio = _portfolio_or_404(portfolio_id, db)
    return list(sorted(portfolio.snapshots, key=lambda snapshot: snapshot.created_at))


def _goal_or_404(goal_id: str, db: Session) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")
    return goal


def _portfolio_or_404(portfolio_id: str, db: Session) -> Portfolio:
    portfolio = db.get(Portfolio, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found.")
    return portfolio


def _as_response(portfolio: Portfolio) -> PortfolioRead:
    return PortfolioRead(
        id=portfolio.id,
        goal_id=portfolio.goal_id,
        risk_profile=portfolio.risk_profile,
        current_value=portfolio.current_value,
        target_allocation=portfolio.target_allocation,
        holdings=portfolio.holdings,
        actual_allocation=actual_weights(portfolio.holdings),
        created_at=portfolio.created_at,
        updated_at=portfolio.updated_at,
    )
