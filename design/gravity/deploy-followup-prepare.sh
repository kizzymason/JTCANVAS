#!/bin/sh
set -eu
release=/opt/jtcanvas-gravity-release
app=/opt/jtcanvas
for file in \
 web/src/pages/home/index.tsx \
 web/src/pages/image/index.tsx \
 web/src/pages/video/index.tsx \
 web/src/components/layout/app-sidebar.tsx \
 web/src/components/layout/app-shell.module.css \
 nginx.conf \
 server/src/modules/homepage/homepage.controller.ts \
 CHANGELOG.md \
 docs/content/docs/progress/pending-test.mdx \
 docs/content/docs/progress/pending-test.zh-CN.mdx
do
 cp "$release/$file" "$app/$file"
done
rm -f "$release/web/src/stores/use-navigation-store.ts" "$app/web/src/stores/use-navigation-store.ts"
docker tag "$(docker inspect infinite-canvas-web --format '{{.Image}}')" infinite-canvas:gravity-followup-rollback
docker tag "$(docker inspect infinite-canvas-api --format '{{.Image}}')" infinite-canvas-server:gravity-followup-rollback
printf 'Sources synced; current live images tagged for rollback.\n'
