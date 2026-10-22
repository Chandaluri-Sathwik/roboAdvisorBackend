from dataclasses import dataclass

from app.services.risk import RiskProfile

AssetAllocation = dict[str, int]

TARGET_ALLOCATIONS: dict[RiskProfile, AssetAllocation] = {
    RiskProfile.CONSERVATIVE: {"equity": 20, "debt": 60, "gold": 10, "cash": 10},
    RiskProfile.MODERATE: {"equity": 50, "debt": 35, "gold": 10, "cash": 5},
    RiskProfile.GROWTH: {"equity": 70, "debt": 20, "gold": 5, "cash": 5},
    RiskProfile.AGGRESSIVE: {"equity": 85, "debt": 10, "gold": 3, "cash": 2},
}

SAMPLE_PRODUCTS = {
    "equity": {"name": "Nifty 50 Index Fund", "expense_ratio": 0.20},
    "debt": {"name": "Short Duration Debt Fund", "expense_ratio": 0.35},
    "gold": {"name": "Gold ETF", "expense_ratio": 0.40},
    "cash": {"name": "Liquid Reserve", "expense_ratio": 0.00},
}


@dataclass(frozen=True)
class RebalanceTrade:
    asset_class: str
    action: str
    amount: float
    reason: str


def allocation_for(profile: RiskProfile) -> AssetAllocation:
    return TARGET_ALLOCATIONS[profile].copy()


def contribution_split(amount: float, allocation: AssetAllocation) -> dict[str, float]:
    _validate_allocation(allocation)
    return {asset_class: round(amount * weight / 100, 2) for asset_class, weight in allocation.items()}


def actual_weights(holdings: dict[str, float]) -> dict[str, float]:
    total = sum(holdings.values())
    if total <= 0:
        raise ValueError("Portfolio value must be greater than zero")
    return {asset_class: round(value / total * 100, 2) for asset_class, value in holdings.items()}


def preview_rebalance(holdings: dict[str, float], target: AssetAllocation, threshold: float = 5) -> list[RebalanceTrade]:
    _validate_allocation(target)
    weights = actual_weights(holdings)
    total = sum(holdings.values())
    trades: list[RebalanceTrade] = []

    for asset_class, target_weight in target.items():
        current_value = holdings.get(asset_class, 0)
        current_weight = weights.get(asset_class, 0)
        difference = round(total * target_weight / 100 - current_value, 2)
        if abs(current_weight - target_weight) < threshold:
            continue
        trades.append(RebalanceTrade(
            asset_class=asset_class,
            action="buy" if difference > 0 else "sell",
            amount=abs(difference),
            reason=f"Current allocation is {current_weight:.1f}% versus a {target_weight}% target.",
        ))
    return trades


def _validate_allocation(allocation: AssetAllocation) -> None:
    if sum(allocation.values()) != 100:
        raise ValueError("Target allocation must add up to 100")
