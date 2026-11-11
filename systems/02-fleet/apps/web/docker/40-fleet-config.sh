#!/bin/sh
set -eu

fleet_api_url="${FLEET_API_URL:-/api}"
case "$fleet_api_url" in
  /*|http://*|https://*) ;;
  *)
    echo "FLEET_API_URL must be an absolute URL or start with /." >&2
    exit 1
    ;;
esac

escaped_url=$(printf '%s' "$fleet_api_url" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.__FLEET_CONFIG__ = { apiUrl: "%s" };\n' "$escaped_url" \
  > /usr/share/nginx/html/config.js
