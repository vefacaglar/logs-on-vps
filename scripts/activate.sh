#!/usr/bin/env bash
set -euo pipefail
base=${1:?Deployment directory required}
deploy_id=${2:?Deployment ID required}
[[ $base =~ ^/([a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid deployment directory' >&2; exit 1; }
[[ $deploy_id =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid deployment ID' >&2; exit 1; }
release="$base/releases/$deploy_id"
test -x "$release/scripts/start.sh"

# Also serialize manual activations against GitHub-triggered deployments.
exec 9>"$base/.deploy.lock"
flock -w 600 9

previous=''
if [[ -L "$base/current" ]]; then
  previous=$(readlink -f "$base/current")
  [[ $previous == "$base/releases/"* && -x "$previous/scripts/start.sh" ]] || {
    echo 'Invalid previous release link' >&2; exit 1;
  }
elif [[ -e "$base/current" ]]; then
  echo 'The current path must be a release symlink' >&2
  exit 1
fi

if [[ ! -e "$base/.env" ]]; then
  (umask 077; cp "$release/.env.example" "$base/.env")
fi
ln -sfn "$base/.env" "$release/.env"

activate_release() {
  "$release/scripts/start.sh" || return 1
  if [[ -f "$release/browser.env" ]]; then
    python3 "$release/scripts/configure-caddy.py" "$release/browser-settings.json" "$base/caddy-backups" || return 1
  fi
}

if ! activate_release; then
  echo 'Deployment failed.' >&2
  if [[ -n $previous && $previous != "$release" ]]; then
    echo 'Restoring previous release...' >&2
    if ! "$previous/scripts/start.sh"; then
      echo 'Rollback also failed; inspect Docker services on the VPS.' >&2
    fi
  else
    echo 'No previous managed release is available for rollback.' >&2
  fi
  exit 1
fi

ln -s "releases/$deploy_id" "$base/.current-$deploy_id"
mv -Tf "$base/.current-$deploy_id" "$base/current"
printf 'Deployed release: %s\n' "$deploy_id"
