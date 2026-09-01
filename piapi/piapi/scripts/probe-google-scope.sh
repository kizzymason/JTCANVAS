#!/bin/sh
# Same probe as probe-oauth-scope.sh but for the Google provider, to judge
# which identity fields PiAPI asks Google to disclose.
CSRF=$(curl -s -c /tmp/g-cookies.txt https://piapi.ai/api/auth/csrf \
  | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')

LOC=$(curl -s -o /dev/null -D - -b /tmp/g-cookies.txt -c /tmp/g-cookies.txt \
  -X POST \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "callbackUrl=https://piapi.ai/workspace" \
  https://piapi.ai/api/auth/signin/google \
  | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')

echo "authorize URL:"
echo "$LOC"
echo
echo "decoded parameters:"
echo "$LOC" | sed 's/?/\n/' | tail -n1 | tr '&' '\n' | while read -r kv; do
  key=${kv%%=*}
  val=${kv#*=}
  val=$(printf '%s' "$val" | sed 's/+/ /g; s/%3A/:/g; s/%2F/\//g; s/%20/ /g')
  printf '  %-16s %s\n' "$key" "$val"
done
