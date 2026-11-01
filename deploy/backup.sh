#!/bin/sh
# Back up the HadirOps database to ./backups and keep the last 14 days.
#
#   Run nightly from cron on the host, for example:
#   15 1 * * * cd /opt/hadirops && ./deploy/backup.sh >> backups/backup.log 2>&1
#
# Restore one archive (stops nothing; --drop replaces the collections):
#   docker compose -f docker-compose.prod.yml exec -T db mongorestore \
#     --username "$DB_USER" --password "$DB_PASSWORD" --authenticationDatabase admin \
#     --archive --gzip --drop < backups/hadirops-<stamp>.archive.gz
#
# Copy ./backups off this machine as well; a backup on the same disk does not
# survive the disk.
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="backups/hadirops-$stamp.archive.gz"
docker compose -f docker-compose.prod.yml exec -T db mongodump \
  --username "${DB_USER:-hadirops}" --password "$DB_PASSWORD" --authenticationDatabase admin \
  --db "${DB_NAME:-hadirops}" --archive --gzip > "$out.partial"
mv "$out.partial" "$out"
find backups -name 'hadirops-*.archive.gz' -mtime +14 -delete
echo "backup written: $out ($(wc -c < "$out") bytes)"
