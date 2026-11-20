#!/usr/bin/env bash
# Install or update the app in its web folder, leaving your recipes alone,
# then rebuild the recipe index.
#
#   deploy/deploy.sh <web-folder>        e.g. deploy/deploy.sh /mnt/nas/recipes
#
# Copies site/ into <web-folder>, removing app files that no longer exist,
# but never touches <web-folder>/recipes/. Safe to run repeatedly.
set -euo pipefail

usage() { echo "Usage: $0 <web-folder>   e.g. $0 /mnt/nas/recipes" >&2; exit 2; }
[[ $# -eq 1 ]] || usage

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
target="$1"
[[ -d "$target" ]] || { echo "Not a folder: $target (create it first)" >&2; exit 2; }
target="$(cd "$target" && pwd -P)"

# Refuse folders that are clearly not a dedicated web folder:
# "/", any top-level folder (/mnt, /srv, /home…), your home folder, or this repository.
depth="$(tr -cd '/' <<<"$target" | wc -c)"
if [[ "$target" == "/" || "$depth" -lt 2 || "$target" == "${HOME:-/nonexistent}" ]]; then
  echo "Refusing to deploy into $target: use a dedicated folder such as /mnt/nas/recipes" >&2
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

command -v rsync >/dev/null || { echo "rsync is required (sudo apt install rsync)" >&2; exit 2; }
command -v node >/dev/null || { echo "Node.js 20+ is required" >&2; exit 2; }

mkdir -p "$target/recipes"
# -rt: no owners/permissions (they don't apply on SMB mounts); 2s timestamp
# tolerance for filesystems with coarse times.
rsync -rt --delete --modify-window=2 \
  --exclude '/recipes/' --exclude '.*' \
  "$repo/site/" "$target/"

node "$repo/tools/build-index.mjs" "$target/recipes" --if-changed
echo "Deployed $(git -C "$repo" describe --always --dirty 2>/dev/null || echo 'app') to $target"
