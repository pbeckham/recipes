#!/usr/bin/env bash
# Install or update the app (site/) in its web folder on the Pi.
#
#   deploy/deploy.sh [<web-folder>]          default: /var/www/recipes
#
# Copies site/ into the web folder and removes app files that no longer
# exist. Your recipes are not touched (they are served from the NAS).
# Then rebuilds the index via recipes-index.service if it is installed.
# Run with sudo when the web folder belongs to root (the default).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
target="${1:-/var/www/recipes}"
[[ $# -le 1 ]] || { echo "Usage: $0 [<web-folder>]" >&2; exit 2; }

command -v rsync >/dev/null || { echo "rsync is required: sudo apt install rsync" >&2; exit 2; }
mkdir -p "$target"
target="$(cd "$target" && pwd -P)"

# Refuse folders that are clearly not a dedicated web folder:
# "/", any top-level folder (/var, /srv, /home…), your home folder, or this repository.
depth="$(tr -cd '/' <<<"$target" | wc -c)"
if [[ "$target" == "/" || "$depth" -lt 2 || "$target" == "${HOME:-/nonexistent}" ]]; then
  echo "Refusing to deploy into $target: use a dedicated folder such as /var/www/recipes" >&2
  exit 2
fi
if [[ "$target/" == "$repo/"* ]]; then
  echo "Refusing to deploy into the repository itself ($target)" >&2
  exit 2
fi
# --delete removes files, so only use it on an empty folder or a previous install.
if [[ -n "$(ls -A "$target")" && ! -f "$target/index.html" ]]; then
  echo "$target is not empty and has no index.html: it doesn't look like a previous install." >&2
  echo "Use an empty folder for a first install." >&2
  exit 2
fi

# -rt: copy contents and times; files end up readable by nginx (umask 022).
umask 022
rsync -rt --delete --chmod=D755,F644 --exclude '/recipes/' --exclude '.*' "$repo/site/" "$target/"
echo "Deployed $(git -C "$repo" describe --always --dirty 2>/dev/null || echo 'the app') to $target"

if command -v systemctl >/dev/null && systemctl cat recipes-index.service >/dev/null 2>&1; then
  systemctl start recipes-index.service && echo "Index rebuilt (recipes-index.service)"
fi
