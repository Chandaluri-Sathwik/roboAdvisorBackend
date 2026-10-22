from dataclasses import dataclass


@dataclass(frozen=True)
class Projection:
    annual_return: float
    future_value: float
    total_contributions: float
    shortfall: float


def project_goal(*, initial_investment: float, monthly_contribution: float, years: int, target_amount: float, annual_return: float) -> Projection:
    if years < 1:
        raise ValueError("Investment horizon must be at least one year")
    if min(initial_investment, monthly_contribution, target_amount, annual_return) < 0:
        raise ValueError("Projection inputs cannot be negative")

    monthly_rate = annual_return / 12
    months = years * 12
    if monthly_rate == 0:
        future_value = initial_investment + monthly_contribution * months
    else:
        future_value = initial_investment * (1 + monthly_rate) ** months
        future_value += monthly_contribution * (((1 + monthly_rate) ** months - 1) / monthly_rate)

    total_contributions = initial_investment + monthly_contribution * months
    return Projection(annual_return, round(future_value, 2), round(total_contributions, 2), round(max(target_amount - future_value, 0), 2))


def required_monthly_contribution(*, initial_investment: float, years: int, target_amount: float, annual_return: float) -> float:
    monthly_rate = annual_return / 12
    months = years * 12
    future_initial = initial_investment * (1 + monthly_rate) ** months
    remaining_target = max(target_amount - future_initial, 0)
    if monthly_rate == 0:
        return round(remaining_target / months, 2)
    annuity_factor = ((1 + monthly_rate) ** months - 1) / monthly_rate
    return round(remaining_target / annuity_factor, 2)
