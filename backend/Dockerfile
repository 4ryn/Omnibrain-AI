FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY backend/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir --default-timeout=1000 --retries=10 -r requirements.txt

COPY backend/ ./
COPY widget/src/ /widget/src/

ENV WIDGET_DIR=/widget/src

RUN mkdir -p /data/uploads

CMD ["sh", "-c", "alembic upgrade head || exit 1; celery -A app.workers.celery_app:celery_app worker --pool=solo --loglevel=INFO & exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]