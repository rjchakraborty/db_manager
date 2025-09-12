#!/bin/bash

# DB Manager - Single Click Deploy and Open Script
# This script deploys the Next.js app on port 3001 and opens it in the default browser

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PORT=3005
PROJECT_NAME="DB Manager"
PROJECT_DIR="/Users/rj/work/projects/python/db_manager"

echo -e "${BLUE}🚀 Starting $PROJECT_NAME deployment...${NC}"

# Change to project directory
cd "$PROJECT_DIR" || {
    echo -e "${RED}❌ Error: Could not change to project directory${NC}"
    exit 1
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Error: Node.js is not installed${NC}"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ Error: npm is not installed${NC}"
    exit 1
fi

# Kill any existing process on the port
echo -e "${YELLOW}🔍 Checking for existing processes on port $PORT...${NC}"
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Killing existing process on port $PORT${NC}"
    kill -9 $(lsof -ti:$PORT) 2>/dev/null || true
    sleep 2
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Error: Failed to install dependencies${NC}"
        exit 1
    fi
fi

# Build the project (optional, for production-like experience)
echo -e "${BLUE}🔨 Building project...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Build failed, continuing with dev mode...${NC}"
fi

# Start the development server in the background
echo -e "${BLUE}🌟 Starting $PROJECT_NAME on port $PORT...${NC}"
PORT=$PORT npm run dev > /dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to start and be ready
echo -e "${YELLOW}⏳ Waiting for server to start...${NC}"
sleep 3

# Check if server is running
if ! lsof -ti:$PORT > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Server failed to start on port $PORT${NC}"
    exit 1
fi

# Wait for server to be ready to serve requests
echo -e "${YELLOW}🔍 Checking server readiness...${NC}"
for i in {1..10}; do
    if curl -s http://localhost:$PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Server is ready!${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${YELLOW}⚠️  Server may still be starting up...${NC}"
    fi
    sleep 1
done

# Open in Firefox browser
URL="http://localhost:$PORT"
echo -e "${GREEN}🎉 Opening $PROJECT_NAME at $URL in Firefox${NC}"

# Try to open in Firefox (check multiple possible locations)
if [ -d "/Applications/Firefox.app" ]; then
    open -a "Firefox" "$URL"
elif [ -d "/Applications/Mozilla Firefox.app" ]; then
    open -a "Mozilla Firefox" "$URL"
else
    echo -e "${YELLOW}⚠️  Firefox not found, trying default browser...${NC}"
    open "$URL"
fi

echo -e "${GREEN}✅ $PROJECT_NAME is now running!${NC}"
echo -e "${BLUE}📍 URL: $URL${NC}"
echo -e "${YELLOW}💡 To stop the server, press Ctrl+C or close this terminal${NC}"
echo -e "${YELLOW}💡 Server PID: $SERVER_PID${NC}"

# Keep the script running to maintain the server
wait $SERVER_PID
