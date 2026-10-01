#!/usr/bin/env bash
# Safe restart of the DEMIURGO API on 8100 (drain, then restart; connection draining as in Kubernetes «Pod lifecycle:
# Termination of Pods» and Google SRE book ch. 7). Run from the host, from anywhere:  scripts/restart-api.sh [name]
#   1. drain on: the queue starts nothing new (running builds and runs finish);
#   2. waits until no ai_runs are running, requested or queued and no builder container is left;
#   3. pg_dump of the database, 4. stops the api, 5. saves a snapshot, 6. starts the api, 7. waits for /api/health,
#   8. drain off.
# If a step fails the script stops with drain still ON (the safe side); `drain off` is then a decision of the person:
#   docker compose exec -T api node packages/api/src/cli.ts drain off     (or: rm .demiurgo-drain)
# It prints no secrets: the database password never leaves the compose containers.
set -euo pipefail

cd "$(dirname "$0")/.."
NAME="${1:-restart-$(date +%Y%m%d-%H%M%S)}"
BACKUPS="$HOME/Development/DEMIURGO-prompts/backups"
CLI="node packages/api/src/cli.ts"
export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima}"
WAIT_MIN="${WAIT_MIN:-60}"

trap 'echo "FAILED: the drain flag stays ON (nothing new starts). Turn it off with: rm .demiurgo-drain" >&2' ERR

echo "1/8 drain on"
docker compose exec -T api $CLI drain on --reason "restart-api.sh $NAME" >/dev/null

echo "2/8 waiting for ai_runs and builder containers to finish (up to ${WAIT_MIN} min)"
deadline=$(( $(date +%s) + WAIT_MIN * 60 ))
while :; do
  status="$(docker compose exec -T api $CLI drain status 2>/dev/null)"
  runs="$(printf '%s' "$status" | grep -o '"active_runs":[0-9]*' | cut -d: -f2)"
  builders="$(docker ps -q --filter label=demiurgo.builder=1 | wc -l | tr -d ' ')"
  if [ "${runs:-1}" = "0" ] && [ "$builders" = "0" ]; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "timeout: ${runs:-?} active runs, $builders builder containers" >&2
    exit 1
  fi
  echo "   ${runs:-?} active runs, $builders builder containers"
  sleep 15
done

echo "3/8 pg_dump -> $BACKUPS/$NAME.dump"
mkdir -p "$BACKUPS"
docker compose exec -T postgres pg_dump -U demiurgo -Fc demiurgo_v2 > "$BACKUPS/$NAME.dump"
test -s "$BACKUPS/$NAME.dump"

echo "4/8 stopping the api"
docker compose stop api

echo "5/8 snapshot $NAME"
docker compose run --rm api pnpm snap save "$NAME"

echo "6/8 starting the api"
docker compose up -d api

echo "7/8 waiting for /api/health"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8100/api/health; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = "1" ] || { echo "the api did not answer /api/health in 2 minutes" >&2; exit 1; }

echo "8/8 drain off"
docker compose exec -T api $CLI drain off >/dev/null
trap - ERR
echo "done: api restarted, queue resumes within a minute (backup and snapshot: $NAME)"
