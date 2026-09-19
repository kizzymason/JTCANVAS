#!/bin/sh
# Replays the whole migration chain onto a throwaway database, so a hand-written migration is proven
# to apply cleanly after its predecessors before it ever runs against real data.
#
# Usage: verify-migration-chain.sh <migrations-dir> [scratch-db-name]
set -eu

DIR="${1:?usage: verify-migration-chain.sh <migrations-dir> [db]}"
DB="${2:-migration_check}"
PG="infinite-canvas-postgres"

docker exec "${PG}" psql -U infinite -d postgres -c "DROP DATABASE IF EXISTS ${DB}" > /dev/null
docker exec "${PG}" psql -U infinite -d postgres -c "CREATE DATABASE ${DB}" > /dev/null
echo "scratch database ${DB} created"

for file in $(ls "${DIR}"/*.sql | sort); do
    name=$(basename "${file}")
    # Drizzle separates statements with a marker rather than plain semicolons, because a single
    # statement may legitimately contain one. Strip it and let psql run the file as a whole.
    sed 's/--> statement-breakpoint//g' "${file}" > /tmp/_mig.sql
    docker cp /tmp/_mig.sql "${PG}":/tmp/_mig.sql > /dev/null
    if docker exec "${PG}" psql -U infinite -d "${DB}" -v ON_ERROR_STOP=1 -q -f /tmp/_mig.sql > /tmp/_mig.out 2>&1; then
        echo "ok   ${name}"
    else
        echo "FAIL ${name}"
        tail -20 /tmp/_mig.out
        exit 1
    fi
done

echo ""
echo "--- resulting card tables ---"
docker exec "${PG}" psql -U infinite -d "${DB}" -c '\dt card*'
echo "--- card_merchants columns ---"
docker exec "${PG}" psql -U infinite -d "${DB}" -c '\d card_merchants'
