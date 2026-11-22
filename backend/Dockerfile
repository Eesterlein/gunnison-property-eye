FROM python:3.11-slim-bookworm

# GDAL and geospatial dependencies (Bookworm ships GDAL 3.6, required by rasterio 1.4+)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libc6-dev \
    gdal-bin \
    libgdal-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set GDAL environment for rasterio/fiona
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user. /app/cache is the aerial-photo cache volume;
# deploy.sh hands existing volumes to this UID before restarting.
RUN useradd --system --uid 10001 --create-home --home-dir /home/app app \
    && mkdir -p /app/cache/aerial && chown -R app:app /app/cache
USER app

EXPOSE 8000
