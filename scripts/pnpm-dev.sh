#!/bin/bash

# kill掉端口是5173的进程
PORT=5173
PID=$(lsof -ti:$PORT)

if [ ! -z "$PID" ]; then
  echo "Killing process on port $PORT (PID: $PID)..."
  kill -9 $PID
  echo "Process killed."
else
  echo "No process found on port $PORT."
fi

pnpm install
# pnpm dev
pnpm --filter @aiwork/desktop dev:tauri