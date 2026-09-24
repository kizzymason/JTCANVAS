#!/bin/sh
set -eu
cd /opt/jtcanvas
test "$(cat /opt/jtcanvas-gravity-release/build.exit)" = 0
test -s /opt/jtcanvas-backups/gravity-before/database.dump
tar -xzf /tmp/gravity-release.tar.gz -C /opt/jtcanvas
cp /opt/jtcanvas-gravity-release/web/public/page-updated.html web/public/page-updated.html
cp /opt/jtcanvas-gravity-release/web/index.html web/index.html
docker tag infinite-canvas:gravity-candidate infinite-canvas:local
docker tag infinite-canvas-server:gravity-candidate infinite-canvas-server:local
if ! docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build --wait api web; then
 docker tag infinite-canvas:gravity-rollback infinite-canvas:local
 docker tag infinite-canvas-server:gravity-rollback infinite-canvas-server:local
 docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build --wait api web
 echo 'Deployment failed; previous images restored.'
 exit 1
fi
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --no-build worker
curl -fsS http://127.0.0.1:3000/api/health
printf '\nDEPLOY_OK\n'
