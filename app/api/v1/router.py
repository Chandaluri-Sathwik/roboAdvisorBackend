from fastapi import APIRouter

from app.api.v1 import planning, portfolios, users

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(planning.router)
api_router.include_router(portfolios.router)
