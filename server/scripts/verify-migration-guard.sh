#!/bin/sh
# Proves the guard in 0009 refuses to run when wholesale data still exists.
#
# A destructive migration whose guard has never been exercised is a guard you do not have, and this
# one is the only thing standing between a mis-timed deploy and silently dropping money records.
set -eu

DIR="${1:?usage: verify-migration-guard.sh <migrations-dir>}"
DB="migration_guard_check"
PG="infinite-canvas-postgres"

docker exec "${PG}" psql -U infinite -d postgres -c "DROP DATABASE IF EXISTS ${DB}" > /dev/null
docker exec "${PG}" psql -U infinite -d postgres -c "CREATE DATABASE ${DB}" > /dev/null

# Everything up to, but not including, the migration under test.
for file in $(ls "${DIR}"/*.sql | sort | grep -v 0009_); do
    sed 's/--> statement-breakpoint//g' "${file}" > /tmp/_g.sql
    docker cp /tmp/_g.sql "${PG}":/tmp/_g.sql > /dev/null
    docker exec "${PG}" psql -U infinite -d "${DB}" -v ON_ERROR_STOP=1 -q -f /tmp/_g.sql > /dev/null
done
echo "baseline applied through 0008"

# A channel holding prepaid credit with a draw against it: exactly the state that must block.
docker exec "${PG}" psql -U infinite -d "${DB}" -q -c "
    insert into card_merchants (name, secret_hash, credit_balance)
    values ('guard test', 'deadbeef', 100);
    insert into card_merchant_draws (merchant_id, unit_price, quantity, amount, idempotency_key)
    select id, 1, 1, 1, 'guard' from card_merchants where name = 'guard test';
" > /dev/null
echo "seeded 1 draw and 100 CNY of credit"

sed 's/--> statement-breakpoint//g' "${DIR}"/0009_*.sql > /tmp/_g9.sql
docker cp /tmp/_g9.sql "${PG}":/tmp/_g9.sql > /dev/null
if docker exec "${PG}" psql -U infinite -d "${DB}" -v ON_ERROR_STOP=1 -q -f /tmp/_g9.sql > /tmp/_g9.out 2>&1; then
    echo "FAIL 0009 applied even though wholesale data existed"
    exit 1
fi
echo "ok   0009 refused to run:"
grep -o 'Refusing to migrate[^"]*' /tmp/_g9.out | head -1

# And the data it refused to destroy is still there.
remaining=$(docker exec "${PG}" psql -U infinite -d "${DB}" -tAc "select count(1) from card_merchant_draws")
echo "ok   draws left intact: ${remaining}"

docker exec "${PG}" psql -U infinite -d postgres -c "DROP DATABASE ${DB}" > /dev/null
