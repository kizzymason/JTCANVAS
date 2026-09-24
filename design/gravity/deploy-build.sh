#!/bin/sh
set -eu
trap 'printf "%s\n" "$?" > /opt/jtcanvas-gravity-release/build.exit' EXIT
cd /opt/jtcanvas-gravity-release
docker build -f server/Dockerfile -t infinite-canvas-server:gravity-candidate .
docker build -f Dockerfile -t infinite-canvas:gravity-candidate .
