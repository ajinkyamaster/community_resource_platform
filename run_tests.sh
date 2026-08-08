#!/bin/bash
set -e

run_suite() {
  echo "--- Resetting database ---"
  docker compose down -v
  docker compose up -d db
  
  echo "Waiting for postgres to be ready..."
  for i in {1..15}; do
    if docker compose exec -T db pg_isready -U postgres > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  sleep 1

  echo "--- Running test suite ---"
  # Run tests sequentially to avoid deadlocks in resetDatabase()
  for file in "account-deletion" "auth" "membership" "ownership-transfer" "resources"; do
    echo "Running tests/${file}.test.ts ..."
    docker compose run \
      -e DATABASE_URL_TEST="postgresql://app_user:app_password@db:5432/community_resource_db" \
      -e MIGRATION_DATABASE_URL_TEST="postgresql://postgres:postgres@db:5432/community_resource_db" \
      --rm api npx tsx --test tests/${file}.test.ts
  done
}

echo "=== FIRST RUN ==="
run_suite

echo "=== SECOND RUN ==="
run_suite

echo "All tests passed successfully both times!"
