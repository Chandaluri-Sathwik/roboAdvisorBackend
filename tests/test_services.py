from app.services.portfolio import allocation_for, contribution_split, preview_rebalance
from app.services.projections import project_goal, required_monthly_contribution
from app.services.risk import RiskProfile, assess_risk


def test_risk_assessment_applies_short_horizon_cap() -> None:
    result = assess_risk(
        willingness=90,
        capacity=90,
        horizon=20,
        emergency_fund_months=6,
        debt_to_income_ratio=0.1,
    )

    assert result.profile == RiskProfile.CONSERVATIVE
    assert result.warnings


def test_contribution_split_matches_target_allocation() -> None:
    allocation = allocation_for(RiskProfile.MODERATE)

    assert contribution_split(100_000, allocation) == {
        "equity": 50_000.0,
        "debt": 35_000.0,
        "gold": 10_000.0,
        "cash": 5_000.0,
    }


def test_rebalance_preview_identifies_material_drift() -> None:
    trades = preview_rebalance(
        {"equity": 61_000, "debt": 27_000, "gold": 8_000, "cash": 4_000},
        allocation_for(RiskProfile.MODERATE),
    )

    assert any(trade.asset_class == "equity" and trade.action == "sell" for trade in trades)
    assert any(trade.asset_class == "debt" and trade.action == "buy" for trade in trades)


def test_projection_and_required_contribution_are_positive() -> None:
    projection = project_goal(
        initial_investment=100_000,
        monthly_contribution=15_000,
        years=10,
        target_amount=5_000_000,
        annual_return=0.09,
    )

    assert projection.future_value > projection.total_contributions
    assert required_monthly_contribution(
        initial_investment=100_000,
        years=10,
        target_amount=5_000_000,
        annual_return=0.09,
    ) > 0
