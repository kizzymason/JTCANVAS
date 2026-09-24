#!/bin/sh
set -eu
cd /opt/jtcanvas
restore() {
 docker tag infinite-canvas:gravity-followup-rollback infinite-canvas:local
 docker tag infinite-canvas-server:gravity-followup-rollback infinite-canvas-server:local
 docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build api web
 docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build worker
}
docker tag infinite-canvas:gravity-candidate infinite-canvas:local
docker tag infinite-canvas-server:gravity-candidate infinite-canvas-server:local
if ! docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build --wait api web; then
 restore
 echo 'API/web health wait failed; current production images restored.'
 exit 1
fi
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build worker
if ! curl -fsS http://127.0.0.1:3000/api/health; then
 restore
 echo 'Health endpoint failed; current production images restored.'
 exit 1
fi
printf '\nDEPLOY_OK\n'
