#!/usr/bin/env bash
# PostFreely — Start
PORT=${1:-5000}
cd "$(dirname "$0")/.."
export PORT=$PORT
python backend/core/server.py
