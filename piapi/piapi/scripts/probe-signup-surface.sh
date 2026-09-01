#!/bin/sh
# Sweeps piapi.ai for any account-creation surface other than the two OAuth
# buttons: alternative hosts, signup pages, NextAuth internals, and the error
# page that AccessDenied lands on.
probe() {
  code=$(curl -s -o /tmp/body.$$ -w '%{http_code}' -m 15 -L "$1" 2>/dev/null)
  size=$(wc -c < /tmp/body.$$ 2>/dev/null | tr -d ' ')
  snippet=$(tr -d '\r\n' < /tmp/body.$$ 2>/dev/null | sed 's/  */ /g' | cut -c1-110)
  printf '%-58s %-4s %-8s %s\n' "$1" "$code" "${size}b" "$snippet"
  rm -f /tmp/body.$$
}

echo "===== NextAuth internals ====="
for p in \
  https://piapi.ai/api/auth/providers \
  https://piapi.ai/api/auth/csrf \
  https://piapi.ai/api/auth/session \
  https://piapi.ai/api/auth/error \
  "https://piapi.ai/api/auth/error?error=AccessDenied" \
  https://piapi.ai/api/auth/signin ; do probe "$p"; done

echo
echo "===== possible signup pages ====="
for p in \
  https://piapi.ai/signup \
  https://piapi.ai/register \
  https://piapi.ai/login \
  https://piapi.ai/auth/signup \
  https://piapi.ai/workspace/signup ; do probe "$p"; done

echo
echo "===== alternative hosts ====="
for p in \
  https://api.piapi.ai/ \
  https://app.piapi.ai/ \
  https://docs.piapi.ai/ \
  https://api.piapi.ai/api/v1/user \
  https://api.piapi.ai/v1/user ; do probe "$p"; done

echo
echo "===== does the API accept a key-less request? ====="
probe https://api.piapi.ai/api/v1/task
