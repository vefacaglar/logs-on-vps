#!/bin/sh
set -eu
cd "$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"

command -v curl >/dev/null 2>&1 || { echo 'curl is required.' >&2; exit 1; }
docker compose config --quiet
docker compose pull
docker compose run --rm --no-deps --volume /var/lib/vector vector validate --skip-healthchecks /etc/vector/vector.yaml
docker compose run --rm --no-deps --volume /var/lib/vector vector test /etc/vector/vector.yaml
# Recreate to apply changed bind-mounted Vector configuration on every update.
docker compose up -d --remove-orphans --force-recreate

address=$(docker compose port victorialogs 9428)
attempt=0
until curl --fail --silent --max-time 3 "http://$address/health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose logs --tail=40 >&2
    echo 'VictoriaLogs did not become healthy.' >&2
    exit 1
  fi
  sleep 2
done

./scripts/smoke-test.sh
printf '\nReady: http://%s/select/vmui/\n' "$address"
