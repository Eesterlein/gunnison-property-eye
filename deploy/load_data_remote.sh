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
$COMPOSE exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" </dev/null
$COMPOSE exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB" </dev/null
$COMPOSE exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < deploy/demo.dump
rm deploy/demo.dump
$COMPOSE start backend tipg </dev/null
$COMPOSE exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT 'Loaded: ' || (SELECT count(*) FROM parcels) || ' parcels, ' || (SELECT count(*) FROM flags) || ' flags'" </dev/null
