#!/bin/bash

# SSH Tunnel Script for RDS Connection
# This script will prompt for passphrase in the terminal

SSH_KEY="/Users/rj/.ssh/rds_tunnel_piston"
LOCAL_PORT="5432"
REMOTE_HOST="pistonpay-production.cluster-clqgisc6055w.us-west-1.rds.amazonaws.com"
REMOTE_PORT="5432"
SSH_USER="rj"
SSH_HOST="13.57.251.189"

echo "🔐 Starting SSH tunnel to RDS..."
echo "📝 You will be prompted for your SSH key passphrase"

# Check if key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH key not found at $SSH_KEY"
    exit 1
fi

# Set correct permissions
chmod 600 "$SSH_KEY"

# Kill any existing process on the port
if lsof -ti :$LOCAL_PORT > /dev/null 2>&1; then
    echo "⚠️  Killing existing process on port $LOCAL_PORT"
    kill -9 $(lsof -ti :$LOCAL_PORT) 2>/dev/null || true
    sleep 2
fi

echo "🚀 Establishing SSH tunnel..."
echo "💡 The tunnel will remain active. Press Ctrl+C to stop."

# Start SSH tunnel with proper terminal access
exec ssh -i "$SSH_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    -o BatchMode=no \
    -N \
    -L "${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT}" \
    "${SSH_USER}@${SSH_HOST}"