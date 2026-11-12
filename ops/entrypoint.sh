#!/bin/sh
set -eu
# A new Fly volume is root-owned and masks image-layer directory ownership.
# Initialize just the database directory/files, then run the application as node.
if [ "$(id -u)" = "0" ]; then
  database_path="${DATABASE_PATH:-/app/data/ride-remix.sqlite}"
  database_dir="$(dirname "$database_path")"
  mkdir -p "$database_dir"
  chown node:node "$database_dir"
  chmod 700 "$database_dir"
  for database_file in "$database_path" "$database_path-wal" "$database_path-shm"; do
    if [ -f "$database_file" ]; then
      chown node:node "$database_file"
      chmod 600 "$database_file"
    fi
  done
  exec gosu node "$@"
fi
exec "$@"
