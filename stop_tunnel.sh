#!/bin/bash

echo "🔍 Looking for active SSH tunnels on port 5432..."

# Find SSH processes related to our tunnel
TUNNEL_PIDS=$(pgrep -f "ssh.*5432.*pistonpay-production")

if [ -z "$TUNNEL_PIDS" ]; then
    echo "❌ No active SSH tunnel found for port 5432"
    exit 0
fi

echo "🛑 Found active tunnel process(es): $TUNNEL_PIDS"
echo "💀 Stopping SSH tunnel..."

# Kill the tunnel processes
echo "$TUNNEL_PIDS" | xargs kill 2>/dev/null

# Wait a moment
sleep 2

# Verify tunnel is stopped
if lsof -i :5432 >/dev/null 2>&1; then
    echo "⚠️  Process still running, trying force kill..."
    echo "$TUNNEL_PIDS" | xargs kill -9 2>/dev/null
    sleep 1
fi

# Final check
if ! lsof -i :5432 >/dev/null 2>&1; then
    echo "✅ SSH tunnel stopped successfully"
    echo "🔌 Port 5432 is now free"
else
    echo "❌ Failed to stop tunnel. You may need to manually kill the process:"
    echo "   ps aux | grep ssh"
    echo "   kill -9 <process_id>"
fi