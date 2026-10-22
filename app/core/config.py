from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "FinGuide API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://finguide:finguide@localhost:5432/finguide"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    auto_create_schema: bool = False

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @property
    def parsed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
