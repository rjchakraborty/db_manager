#!/bin/bash

# Simple RDS tunnel starter for programmatic use
# This version is designed to work with Node.js process communication

# Check if SSH key exists
SSH_KEY_PATH="/Users/rj/.ssh/rds_tunnel_piston"
if [ ! -f "$SSH_KEY_PATH" ]; then
    echo "ERROR: SSH key not found at $SSH_KEY_PATH" >&2
    exit 1
fi

# Set correct permissions for SSH key
chmod 600 "$SSH_KEY_PATH"

# Check if port 5432 is already in use and kill existing SSH tunnels
EXISTING_PIDS=$(lsof -ti :5432 2>/dev/null)
if [ ! -z "$EXISTING_PIDS" ]; then
    echo "Killing existing processes on port 5432..." >&2
    echo "$EXISTING_PIDS" | xargs -r kill 2>/dev/null || true
    sleep 2
fi

# Start SSH tunnel in background
echo "Establishing SSH tunnel..." >&2
ssh -i "$SSH_KEY_PATH" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=15 \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    -f \
    -N \
    -L 5432:pistonpay-production.cluster-clqgisc6055w.us-west-1.rds.amazonaws.com:5432 \
    rj@13.57.251.189

# Wait and check if tunnel is active
sleep 3
if lsof -i :5432 >/dev/null 2>&1; then
    echo "SSH tunnel established successfully!"
    echo "Database is now accessible at localhost:5432"
    exit 0
else
    echo "ERROR: Failed to establish tunnel connection" >&2
    exit 1
fi