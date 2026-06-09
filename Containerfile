# Build frontend
FROM docker.io/library/node:22-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Runtime backend + static
FROM docker.io/library/node:22-alpine
RUN apk add --no-cache git

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY backend/src ./src
COPY --from=frontend-build /build/dist ./static

ENV HOST=0.0.0.0
ENV PORT=3100
ENV REPO_MOUNT_PATH=/workspace/repo

EXPOSE 3100
CMD ["node", "src/index.js"]
