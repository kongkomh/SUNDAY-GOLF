#!/usr/bin/env bash
# Ryder Cup Live - Start Script
PORT=${1:-8080}
echo "=========================================================="
echo "⛳ Launching Ryder Cup Live 18-Hole Continuous Web App"
echo "   URL: http://localhost:${PORT}"
echo "=========================================================="
python3 backend/server.py "$PORT"
