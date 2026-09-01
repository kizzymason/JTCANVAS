#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${DATA_DIR}/screenshots" "${DATA_DIR}/browser-profile"
# Removed global-session mode used one identity for every account. Delete the
# obsolete shared cookie file; per-account profiles are the only session store.
rm -f "${DATA_DIR}/storage-state.json"

# The named volume is created root-owned; Playwright's `pwuser` cannot write to
# it unless we hand it over here, and Chromium fails to start without a profile.
if id -u pwuser >/dev/null 2>&1; then
  chown -R pwuser:pwuser "${DATA_DIR}" 2>/dev/null || true
fi

# noVNC serves its client from vnc.html; some builds only ship index.html.
if [ -d /usr/share/novnc ] && [ ! -f /usr/share/novnc/vnc.html ] && [ -f /usr/share/novnc/index.html ]; then
  ln -sf /usr/share/novnc/index.html /usr/share/novnc/vnc.html
fi

exec "$@"
