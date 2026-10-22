from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Goal, User
from app.schemas.api import GoalCreate, GoalRead, ProjectionRead, ProjectionRequest
from app.services.projections import project_goal

router = APIRouter(tags=["goals and projections"])


@router.post("/users/{user_id}/goals", response_model=GoalRead, status_code=status.HTTP_201_CREATED)
def create_goal(user_id: str, payload: GoalCreate, db: Session = Depends(get_db)) -> Goal:
    _user_or_404(user_id, db)
    goal = Goal(user_id=user_id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.get("/users/{user_id}/goals", response_model=list[GoalRead])
def list_goals(user_id: str, db: Session = Depends(get_db)) -> list[Goal]:
    _user_or_404(user_id, db)
    return list(db.scalars(select(Goal).where(Goal.user_id == user_id).order_by(Goal.created_at.desc())))


@router.patch("/goals/{goal_id}", response_model=GoalRead)
def update_goal(goal_id: str, payload: GoalCreate, db: Session = Depends(get_db)) -> Goal:
    goal = _goal_or_404(goal_id, db)
    for field, value in payload.model_dump().items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.post("/projections", response_model=list[ProjectionRead])
def create_projection(payload: ProjectionRequest) -> list[ProjectionRead]:
    return [
        ProjectionRead(**project_goal(**payload.model_dump(), annual_return=return_rate).__dict__)
        for return_rate in (0.06, 0.09, 0.12)
    ]


def _user_or_404(user_id: str, db: Session) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


def _goal_or_404(goal_id: str, db: Session) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")
    return goal
