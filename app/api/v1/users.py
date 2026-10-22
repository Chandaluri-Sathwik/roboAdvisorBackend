from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import FinancialProfile, RiskAssessment, User
from app.schemas.api import FinancialProfileRead, FinancialProfileUpsert, RiskAssessmentRead, RiskAssessmentRequest, UserCreate, UserRead
from app.services.risk import assess_risk

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists.")
    user = User(**payload.model_dump())
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: str, db: Session = Depends(get_db)) -> User:
    return _user_or_404(user_id, db)


@router.get("/{user_id}/profile", response_model=FinancialProfileRead)
def get_profile(user_id: str, db: Session = Depends(get_db)) -> FinancialProfile:
    return _profile_for_user(user_id, db)


@router.put("/{user_id}/profile", response_model=FinancialProfileRead)
def upsert_profile(user_id: str, payload: FinancialProfileUpsert, db: Session = Depends(get_db)) -> FinancialProfile:
    _user_or_404(user_id, db)
    profile = db.scalar(select(FinancialProfile).where(FinancialProfile.user_id == user_id))
    if profile is None:
        profile = FinancialProfile(user_id=user_id, **payload.model_dump())
        db.add(profile)
    else:
        for field, value in payload.model_dump().items():
            setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/{user_id}/risk-assessments", response_model=RiskAssessmentRead, status_code=status.HTTP_201_CREATED)
def create_risk_assessment(user_id: str, payload: RiskAssessmentRequest, db: Session = Depends(get_db)) -> RiskAssessment:
    profile = _profile_for_user(user_id, db)
    emergency_months = profile.emergency_fund / profile.monthly_expenses if profile.monthly_expenses else 12
    debt_ratio = profile.monthly_debt_payment / profile.monthly_income if profile.monthly_income else 1
    result = assess_risk(
        willingness=payload.willingness_score,
        capacity=payload.capacity_score,
        horizon=payload.horizon_score,
        emergency_fund_months=emergency_months,
        debt_to_income_ratio=debt_ratio,
    )
    assessment = RiskAssessment(
        profile_id=profile.id,
        willingness_score=result.willingness_score,
        capacity_score=result.capacity_score,
        horizon_score=result.horizon_score,
        total_score=result.total_score,
        risk_profile=result.profile.value,
        warnings=result.warnings,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment


def _user_or_404(user_id: str, db: Session) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


def _profile_for_user(user_id: str, db: Session) -> FinancialProfile:
    _user_or_404(user_id, db)
    profile = db.scalar(select(FinancialProfile).where(FinancialProfile.user_id == user_id))
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Financial profile not found. Save a profile before scoring risk.")
    return profile
