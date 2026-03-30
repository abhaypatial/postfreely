FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY . /app

EXPOSE 5000

CMD ["python", "backend/core/server.py"]
