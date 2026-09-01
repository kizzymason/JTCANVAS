#!/bin/sh
# A rotating residential pool hands out a different exit per request, which
# breaks an OAuth flow: Google sees the session move country mid-login and
# demands additional identity verification. Most vendors support a sticky session id in the
# username; this checks whether ours does.
#
#   sh probe-proxy-sticky.sh <host:port> <user> <pass>
HOSTPORT="$1"
USER="$2"
PASS="$3"
SID="piapi$(date +%s)"

ipof() {
  curl -s -m 45 -x "http://$1:$PASS@$HOSTPORT" http://ipinfo.thordata.com \
    | tr -d '\n' | sed 's/.*"ip": *"\([^"]*\)".*/\1/'
}

echo "=== sticky (sessid=$SID) ==="
for i in 1 2 3; do
  printf '  try %s: %s\n' "$i" "$(ipof "${USER}-sessid-${SID}-sesstime-30")"
done

echo "=== rotating (no sessid) ==="
for i in 1 2 3; do
  printf '  try %s: %s\n' "$i" "$(ipof "$USER")"
done
