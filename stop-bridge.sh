#!/bin/bash

# OpenClaw WeChat Bridge 停止脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Stopping OpenClaw WeChat Bridge...${NC}"

# 查找进程 ID
# 匹配 src/bridge/server.ts
PIDS=$(ps aux | grep "src/bridge/server.ts" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
    echo -e "${YELLOW}No running bridge service found.${NC}"
else
    echo -e "${YELLOW}Found process(es): $PIDS${NC}"
    for PID in $PIDS; do
        kill $PID 2>/dev/null
        echo -e "${GREEN}Sent stop signal to process $PID${NC}"
    done
    
    # 等待进程退出
    sleep 2
    
    # 再次检查
    REMAINING=$(ps aux | grep "src/bridge/server.ts" | grep -v grep | awk '{print $2}')
    
    if [ -n "$REMAINING" ]; then
        echo -e "${YELLOW}Some processes are still running. Force killing...${NC}"
        for PID in $REMAINING; do
            kill -9 $PID 2>/dev/null
            echo -e "${RED}Force killed process $PID${NC}"
        done
    fi
    
    echo -e "${GREEN}Bridge service stopped.${NC}"
fi
