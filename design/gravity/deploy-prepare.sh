#!/bin/sh
set -eu
release=/opt/jtcanvas-gravity-release
backup=/opt/jtcanvas-backups/gravity-before
test ! -e "$backup"
umask 077
mkdir -p "$backup" "$release"
docker inspect infinite-canvas-web --format '{{.Image}}' > "$backup/web-image.txt"
docker inspect infinite-canvas-api --format '{{.Image}}' > "$backup/server-image.txt"
docker tag "$(cat "$backup/web-image.txt")" infinite-canvas:gravity-rollback
docker tag "$(cat "$backup/server-image.txt")" infinite-canvas-server:gravity-rollback
docker exec infinite-canvas-postgres pg_dump -U infinite -d infinite_canvas -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
docker exec -i infinite-canvas-postgres pg_restore --list < "$backup/database.dump" > "$backup/database-contents.txt"
tar -czf "$backup/source-and-config.tar.gz" -C /opt/jtcanvas .env docker-compose.yml docker-compose.local.yml Dockerfile nginx.conf VERSION CHANGELOG.md server/src server/package.json server/package-lock.json server/Dockerfile server/tsconfig.json server/tsconfig.build.json web/src web/public web/package.json web/bun.lock web/index.html web/vite.config.ts web/tsconfig.json web/docker-entrypoint.sh
printf 'Backup verified: %s\n' "$backup"
du -sh "$backup"
