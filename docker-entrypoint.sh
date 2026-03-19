#!/bin/sh
set -e

echo "Build marker: $(date)"
echo "Listing migrations..."
ls -la /app/prisma/migrations/ 2>/dev/null || echo "No migrations dir"

echo "Running database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy || echo "Migration failed but continuing..."

echo "Starting Next.js server..."
exec node server.js
