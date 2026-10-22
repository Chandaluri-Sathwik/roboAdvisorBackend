from dataclasses import dataclass
from enum import StrEnum


class RiskProfile(StrEnum):
    CONSERVATIVE = "Conservative"
    MODERATE = "Moderate"
    GROWTH = "Growth"
    AGGRESSIVE = "Aggressive"


@dataclass(frozen=True)
class RiskResult:
    willingness_score: int
    capacity_score: int
    horizon_score: int
    total_score: int
    profile: RiskProfile
    warnings: list[str]


def assess_risk(*, willingness: int, capacity: int, horizon: int, emergency_fund_months: float, debt_to_income_ratio: float) -> RiskResult:
    _validate_score(willingness, "willingness")
    _validate_score(capacity, "capacity")
    _validate_score(horizon, "horizon")

    total_score = round(willingness * 0.4 + capacity * 0.4 + horizon * 0.2)
    warnings: list[str] = []
    profile = _profile_for_score(total_score)

    if emergency_fund_months < 3:
        warnings.append("Build an emergency reserve before increasing exposure to volatile investments.")
        profile = _cap_profile(profile, RiskProfile.MODERATE)
    if debt_to_income_ratio > 0.35:
        warnings.append("Debt repayments are high relative to income; debt reduction may be a competing priority.")
        profile = _cap_profile(profile, RiskProfile.MODERATE)
    if horizon < 30:
        warnings.append("A short time horizon calls for greater liquidity and lower volatility.")
        profile = _cap_profile(profile, RiskProfile.CONSERVATIVE)

    return RiskResult(willingness, capacity, horizon, total_score, profile, warnings)


def _validate_score(value: int, field_name: str) -> None:
    if not 0 <= value <= 100:
        raise ValueError(f"{field_name} must be between 0 and 100")


def _profile_for_score(score: int) -> RiskProfile:
    if score < 36:
        return RiskProfile.CONSERVATIVE
    if score < 61:
        return RiskProfile.MODERATE
    if score < 78:
        return RiskProfile.GROWTH
    return RiskProfile.AGGRESSIVE


def _cap_profile(profile: RiskProfile, maximum: RiskProfile) -> RiskProfile:
    order = [RiskProfile.CONSERVATIVE, RiskProfile.MODERATE, RiskProfile.GROWTH, RiskProfile.AGGRESSIVE]
    return order[min(order.index(profile), order.index(maximum))]
