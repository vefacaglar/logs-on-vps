#!/bin/sh
set -eu
cd "$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"

address=$(docker compose port victorialogs 9428)
token="logs-smoke-$(date +%s)-$$"
container="$token"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# A new container proves discovery across Compose projects without app changes.
docker run -d --name "$container" --log-driver json-file \
  --log-opt max-size=1m --log-opt max-file=1 \
  --label com.docker.compose.project=logs-smoke \
  --label com.docker.compose.service=probe \
  busybox:1.37.0 sh -c \
  'sleep 3; printf "%s plain\n" "$1"; printf "{\"msg\":\"%s structured\",\"level\":50,\"request_id\":\"probe-42\"}\n" "$1"; sleep 90' \
  sh "$token" >/dev/null

attempt=0
while [ "$attempt" -lt 30 ]; do
  result=$(curl --fail --silent --show-error --max-time 5 \
    "http://$address/select/logsql/query" \
    --data-urlencode "query=_time:5m compose_service:probe \"$token\"" \
    --data-urlencode 'limit=10') || result=''
  if printf '%s' "$result" | grep -Fq "$token plain" && \
     printf '%s' "$result" | grep -Fq "$token structured" && \
     printf '%s' "$result" | grep -Fq '"level":"error"' && \
     printf '%s' "$result" | grep -Fq '"app.request_id":"probe-42"'; then
    echo 'OK: Docker stdout -> Vector -> VictoriaLogs; plain text and JSON verified.'
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

docker compose logs --tail=40 vector >&2
echo 'Smoke test failed: expected Docker logs were not found.' >&2
exit 1
