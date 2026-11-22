# Stage 1: Build frontend
FROM node:22-alpine AS frontend
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Install Python packages
FROM python:3.12-slim AS backend
WORKDIR /build
COPY pyproject.toml ./
COPY src/ src/
RUN pip install --no-cache-dir .

# Stage 3: Final image
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages
COPY --from=backend /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=backend /usr/local/bin/jam-session /usr/local/bin/jam-session

# Copy built frontend
COPY --from=frontend /web/dist /app/static

# Copy scripts
COPY scripts/ /app/scripts/

ENV JAM_DATA_DIR=/data
ENV JAM_STATIC_DIR=/app/static
ENV JAM_PORT=8000

EXPOSE 8000

# /health runs a query against SQLite and returns 503 if the DB is unusable
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"JAM_PORT\", \"8000\")}/health', timeout=4)" || exit 1

CMD ["jam-session", "serve"]
