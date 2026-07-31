#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/home/ubuntu/Team3-AssignmentTask-Project"
HEALTH_URL="http://127.0.0.1:3000/health"
MAX_ATTEMPTS=30
RETRY_DELAY_SECONDS=5

show_failure_details() {
  local exit_code=$?
  trap - ERR

  echo "Deployment failed. Showing container status and recent logs." >&2
  docker compose ps || true
  docker compose logs --no-color --tail=100 app database || true

  exit "$exit_code"
}

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Project directory does not exist: $PROJECT_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $PROJECT_DIR/.env. Create the secure EC2 environment file before deploying." >&2
  exit 1
fi

trap show_failure_details ERR

docker compose config > /dev/null
docker compose up -d --build

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  echo "Health check attempt $attempt of $MAX_ATTEMPTS..."

  if curl --fail --silent --show-error "$HEALTH_URL"; then
    echo
    echo "Deployment health check succeeded."
    docker compose ps
    trap - ERR
    exit 0
  fi

  if ((attempt < MAX_ATTEMPTS)); then
    sleep "$RETRY_DELAY_SECONDS"
  fi
done

echo "Application did not become healthy after $MAX_ATTEMPTS attempts." >&2
false
