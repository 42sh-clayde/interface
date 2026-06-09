# Build frontend
FROM docker.io/library/node:22-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Runtime
FROM docker.io/library/python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /build/dist ./static

ENV HOST=0.0.0.0
ENV PORT=3100
ENV REPO_MOUNT_PATH=/workspace/repo

EXPOSE 3100
CMD ["python", "run.py"]
