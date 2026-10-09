#!/usr/bin/env bash
# Deploy (or update) the app on a single Ubuntu server over SSH.
#   deploy/deploy.sh <server-ip>              code + config update
#   deploy/deploy.sh <server-ip> --load-data  also replace the server DB with deploy/demo.dump
# Needs: deploy/.env.production, secrets/gee-key.json, SSH access as root.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER=${1:?usage: deploy/deploy.sh <server-ip> [--load-data]}
LOAD_DATA=${2:-}
REMOTE=root@$SERVER
APP_DIR=/opt/property-eye
ENV_FILE=deploy/.env.production
COMPOSE="docker compose -f docker-compose.prod.yml --env-file $ENV_FILE"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy deploy/.env.production.example)"; exit 1; }
[ -f secrets/gee-key.json ] || { echo "Missing secrets/gee-key.json"; exit 1; }

# Generate server-only secrets once, if left blank
for key in POSTGRES_PASSWORD JWT_SECRET; do
  if grep -qE "^$key=$" "$ENV_FILE"; then
    sed -i '' "s|^$key=$|$key=$(openssl rand -hex 24)|" "$ENV_FILE"
    echo "Generated $key"
  fi
done

echo "== Preparing server"
ssh "$REMOTE" bash -s <<'REMOTE_SETUP'
set -e
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q && apt-get install -y -q docker.io docker-compose-v2
fi
# 2 GB swap: headroom for image builds and the annual scan on a 2 GB server
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi
mkdir -p /opt/property-eye/secrets /opt/property-eye/deploy
REMOTE_SETUP

echo "== Copying code and config"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude data \
  --exclude secrets --exclude '__pycache__' --exclude 'deploy/*.dump' \
  --exclude "$ENV_FILE" --exclude backend/.env \
  ./ "$REMOTE:$APP_DIR/"
scp -q secrets/gee-key.json "$REMOTE:$APP_DIR/secrets/gee-key.json"
scp -q "$ENV_FILE" "$REMOTE:$APP_DIR/$ENV_FILE"
ssh "$REMOTE" "chmod 600 $APP_DIR/secrets/gee-key.json $APP_DIR/$ENV_FILE"

echo "== Building and starting"
# restart web so Caddy rereads deploy/Caddyfile (a bind mount; `up` alone keeps the old config)
ssh "$REMOTE" "cd $APP_DIR && $COMPOSE up -d --build && $COMPOSE restart web"

if [ "$LOAD_DATA" = "--load-data" ]; then
  [ -f deploy/demo.dump ] || { echo "Run deploy/export_demo_db.sh first"; exit 1; }
  echo "== Loading database"
  scp -q deploy/demo.dump "$REMOTE:$APP_DIR/deploy/demo.dump"
  ssh "$REMOTE" "bash $APP_DIR/deploy/load_data_remote.sh"
fi

SITE=$(grep -E '^SITE_ADDRESS=' "$ENV_FILE" | cut -d= -f2)
echo "== Waiting for https://$SITE"
for i in $(seq 1 30); do
  if curl -fsS "https://$SITE/api/health" >/dev/null 2>&1; then
    echo "Live: https://$SITE"; exit 0
  fi
  sleep 5
done
echo "Not answering yet — check: ssh $REMOTE 'cd $APP_DIR && $COMPOSE logs --tail 50'"
exit 1
