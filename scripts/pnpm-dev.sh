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


# 需要进入opencode目录下执行 bun install

# 在根目录执行 pnpm install 和  dev
pnpm install
# pnpm dev
pnpm --filter @aiwork/desktop dev:tauri