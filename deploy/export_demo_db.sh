#!/usr/bin/env bash
# Export a public-safe copy of the local database for the demo server.
# Copies the local DB into a scratch database, removes everything that
# shouldn't be public, and dumps that — the real local DB is never modified.
#   deploy/export_demo_db.sh            -> deploy/demo.dump
set -euo pipefail
cd "$(dirname "$0")"

DB_CONTAINER=${DB_CONTAINER:-property_eye_db}
PGUSER=${PGUSER:-postgres}
SRC_DB=${SRC_DB:-property_eye}
TMP_DB=property_eye_demo_export
OUT=demo.dump

psql() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" "$@"; }

psql -d postgres -c "DROP DATABASE IF EXISTS $TMP_DB;" -c "CREATE DATABASE $TMP_DB;"
trap 'psql -d postgres -c "DROP DATABASE IF EXISTS '"$TMP_DB"';" >/dev/null' EXIT

docker exec "$DB_CONTAINER" sh -c "pg_dump -U $PGUSER -Fc $SRC_DB | pg_restore -U $PGUSER -d $TMP_DB --no-owner"

psql -d "$TMP_DB" <<'SQL'
-- People: no owner names, no staff accounts or emails
UPDATE parcels SET owner_name = NULL, notes = NULL;
TRUNCATE users;
UPDATE flags SET reviewed_by = NULL, notes = NULL;
UPDATE scans SET triggered_by = CASE WHEN triggered_by = 'scheduler' THEN 'scheduler' ELSE 'manual' END;
-- Only results from the current detection method (v2 has built_local_delta)
DELETE FROM flags WHERE detection_id IN (SELECT id FROM detections WHERE built_local_delta IS NULL);
DELETE FROM detections WHERE built_local_delta IS NULL;
DELETE FROM scans s WHERE NOT EXISTS (SELECT 1 FROM detections d WHERE d.scan_id = s.id);
SQL

# Fail loudly if anything personal survived
LEFT=$(psql -d "$TMP_DB" -tAc "SELECT (SELECT count(*) FROM parcels WHERE owner_name IS NOT NULL) + (SELECT count(*) FROM users) + (SELECT count(*) FROM flags WHERE reviewed_by IS NOT NULL OR notes IS NOT NULL)")
[ "$LEFT" = "0" ] || { echo "Scrub check failed ($LEFT rows still personal)"; exit 1; }

docker exec "$DB_CONTAINER" pg_dump -U "$PGUSER" -Fc "$TMP_DB" > "$OUT"
psql -d "$TMP_DB" -tAc "SELECT 'parcels ' || (SELECT count(*) FROM parcels) || ', scans ' || (SELECT count(*) FROM scans) || ', detections ' || (SELECT count(*) FROM detections) || ', flags ' || (SELECT count(*) FROM flags)"
echo "Wrote deploy/$OUT ($(du -h "$OUT" | cut -f1))"
