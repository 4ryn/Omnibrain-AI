from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    secret_key: str = "dev-insecure-secret-change-me-dev-insecure-secret"
    encryption_key: str = ""
    frontend_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    cookie_secure: bool = False
    session_ttl_hours: int = 336

    database_url: str = "postgresql+asyncpg://omnibrain:omnibrain@localhost:5432/omnibrain"
    redis_url: str = "redis://localhost:6379/0"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/api/auth/google/callback"

    llm_provider: str = "openai"
    llm_model: str = ""
    openai_api_key: str = ""
    groq_api_key: str = ""
    anthropic_api_key: str = ""

    embedding_provider: str = "openai"
    embedding_model: str = ""
    embedding_dimensions: int = 1536

    vector_store: str = "qdrant"
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    pinecone_api_key: str = ""
    pinecone_index: str = ""

    storage_provider: str = "local"
    storage_dir: str = "/data/uploads"
    max_upload_mb: int = 25

    # Observability / limits
    log_format: str = ""                 # json | text (default: json in production, text otherwise)
    metrics_token: str = ""              # /metrics is disabled unless a bearer token is configured
    max_json_body_kb: int = 1024
    model_pricing_json: str = ""         # e.g. {"openai:<model>": [usd_per_1M_input, usd_per_1M_output]}

    # Widget / abuse prevention
    widget_dir: str = ""
    widget_token_ttl_hours: int = 6
    trusted_proxies: int = 0            # number of reverse proxies whose X-Forwarded-For entry to trust
    rl_frame_ip_per_min: int = 60
    rl_widget_ip_per_min: int = 30
    rl_widget_visitor_per_min: int = 20
    rl_widget_workspace_per_min: int = 300
    rl_dashboard_chat_per_min: int = 30

    # Voice (provider-abstracted; platform key used unless the workspace is BYOK)
    stt_provider: str = "openai"
    stt_model: str = ""
    tts_provider: str = "openai"
    tts_model: str = ""
    tts_voice: str = "alloy"
    max_voice_upload_mb: int = 5

    # RAG tuning. Cosine thresholds are model-dependent: calibrate on your own data.
    rag_top_k: int = 15
    rag_min_score: float = 0.30
    rag_strong_score: float = 0.50
    rag_max_context_chars: int = 8000

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @model_validator(mode="after")
    def _check_production(self) -> "Settings":
        if self.is_production:
            if self.secret_key.startswith("dev-insecure") or len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be a strong random value in production")
            if not self.encryption_key:
                raise ValueError("ENCRYPTION_KEY is required in production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
