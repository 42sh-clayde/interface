from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    azdo_org: str = "mon-org"
    azdo_project: str = "mon-projet"
    azdo_repo: str = "mon-repo"
    default_branch: str = "main"
    target_folder: str = "config/apache/redirects"
    repo_mount_path: str = "/workspace/repo"
    remote_name: str = "origin"
    host: str = "0.0.0.0"
    port: int = 3100
    session_secret: str = "change-me-in-production"
    skip_remote_check: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
