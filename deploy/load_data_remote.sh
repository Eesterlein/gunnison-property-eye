#!/usr/bin/env bash
# Runs ON THE SERVER (called by deploy.sh --load-data): replaces the app
# database with deploy/demo.dump, then restarts the services that use it.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=deploy/.env.production
COMPOSE="docker compose -f docker-compose.prod.yml --env-file $ENV_FILE"
set -a; . "./$ENV_FILE"; set +a

# </dev/null on commands that don't read stdin, so nothing swallows input meant for others
$COMPOSE stop backend tipg </dev/null
# Keep the server's own accounts (e.g. the admin login) across reloads —
# the exported demo database deliberately contains none.
USERS_BACKUP=$(mktemp)
$COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t users --data-only </dev/null > "$USERS_BACKUP" 2>/dev/null || true
$COMPOSE exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" </dev/null
$COMPOSE exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB" </dev/null
$COMPOSE exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < deploy/demo.dump
rm deploy/demo.dump
if grep -q "COPY public.users" "$USERS_BACKUP"; then
  $COMPOSE exec -T db psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE users" </dev/null
  $COMPOSE exec -T db psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$USERS_BACKUP"
  echo "Kept existing user accounts"
fi
rm -f "$USERS_BACKUP"
$COMPOSE start backend tipg </dev/null
$COMPOSE exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT 'Loaded: ' || (SELECT count(*) FROM parcels) || ' parcels, ' || (SELECT count(*) FROM flags) || ' flags'" </dev/null
