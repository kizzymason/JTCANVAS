#!/bin/sh
# app.piapi.ai answers with a different bundle than piapi.ai. If it runs its own
# auth (or an older one with email/password), that would be a second way in.
probe() {
  code=$(curl -s -o /tmp/b.$$ -w '%{http_code}' -m 15 "$1" 2>/dev/null)
  size=$(wc -c < /tmp/b.$$ 2>/dev/null | tr -d ' ')
  body=$(tr -d '\r\n' < /tmp/b.$$ 2>/dev/null | sed 's/  */ /g' | cut -c1-160)
  printf '%-52s %-4s %-9s %s\n' "$1" "$code" "${size}b" "$body"
  rm -f /tmp/b.$$
}

echo "===== app.piapi.ai auth surface ====="
for p in \
  https://app.piapi.ai/api/auth/providers \
  https://app.piapi.ai/api/auth/csrf \
  https://app.piapi.ai/api/auth/session \
  https://app.piapi.ai/login \
  https://app.piapi.ai/signup \
  https://app.piapi.ai/register ; do probe "$p"; done

echo
echo "===== where does app.piapi.ai redirect / what is it ====="
curl -s -o /dev/null -D - -m 15 https://app.piapi.ai/ | tr -d '\r' \
  | grep -iE '^(HTTP/|location:|server:|x-powered-by:|set-cookie:)' | cut -c1-140

echo
echo "===== page title and any auth wording ====="
curl -s -m 20 https://app.piapi.ai/ \
  | tr '<' '\n' \
  | grep -oiE 'title>[^&]{0,80}|sign ?up[^"<]{0,40}|log ?in[^"<]{0,40}|email[^"<]{0,30}|password[^"<]{0,30}' \
  | sort -u | head -n 25
