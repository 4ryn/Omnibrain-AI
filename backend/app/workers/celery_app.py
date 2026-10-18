
import ssl

from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "omnibrain",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=900,
    task_soft_time_limit=840,
    task_publish_retry_policy={
        "max_retries": 1,
        "interval_start": 0,
        "interval_step": 0.2,
        "interval_max": 0.5,
    },
    broker_connection_retry_on_startup=True,
    broker_use_ssl={"ssl_cert_reqs": ssl.CERT_REQUIRED},
    redis_backend_use_ssl={"ssl_cert_reqs": ssl.CERT_REQUIRED},
)
