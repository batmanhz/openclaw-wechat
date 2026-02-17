#!/bin/bash

# OpenClaw WeChat Bridge 启动脚本
# 用于一键启动 Bridge 服务

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js is not installed${NC}"
        echo "Please install Node.js 18 or higher: https://nodejs.org/"
        exit 1
    fi

    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}Error: Node.js version must be 18 or higher${NC}"
        echo "Current version: $(node --version)"
        exit 1
    fi

    echo -e "${GREEN}Node.js version: $(node --version)${NC}"
}

# 检查依赖
check_dependencies() {
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Dependencies not found. Installing...${NC}"
        npm install
    fi
}

# 创建数据目录
setup_data_dir() {
    if [ ! -d "data" ]; then
        mkdir -p data
        echo -e "${GREEN}Created data directory${NC}"
    fi
}

# 加载环境变量
load_env() {
    if [ -f ".env" ]; then
        echo -e "${GREEN}Loading environment from .env${NC}"
        export $(cat .env | grep -v '^#' | xargs)
    elif [ -f ".env.example" ]; then
        echo -e "${YELLOW}No .env file found, using .env.example${NC}"
        export $(cat .env.example | grep -v '^#' | xargs)
    fi
}

# 显示配置
show_config() {
    echo -e "${GREEN}========== Bridge Configuration ==========${NC}"
    echo "Port: ${PORT:-3001}"
    echo "Host: ${HOST:-0.0.0.0}"
    echo "Wechaty Name: ${WECHATY_NAME:-openclaw-wechat}"
    echo "Puppet: ${WECHATY_PUPPET:-wechaty-puppet-wechat}"
    echo "Memory Card Path: ${WECHATY_MEMORY_CARD_PATH:-./data}"
    echo "Log Level: ${LOG_LEVEL:-info}"
    echo -e "${GREEN}=========================================${NC}"
}

# 启动服务
start_bridge() {
    echo -e "${GREEN}Starting OpenClaw WeChat Bridge...${NC}"
    echo ""
    echo "API Endpoints:"
    echo "  Health Check:  http://localhost:${PORT:-3001}/health"
    echo "  Account Status: http://localhost:${PORT:-3001}/v1/account/status"
    echo "  Login:         http://localhost:${PORT:-3001}/v1/iPadLogin"
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""

    npm run start:bridge
}

# 主流程
main() {
    echo -e "${GREEN}OpenClaw WeChat Bridge Starter${NC}"
    echo ""

    check_node
    check_dependencies
    setup_data_dir
    load_env
    show_config
    start_bridge
}

# 处理参数
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --dev          Start in development mode with hot reload"
        echo ""
        echo "Environment variables can be set in .env file"
        exit 0
        ;;
    --dev)
        check_node
        check_dependencies
        setup_data_dir
        load_env
        echo -e "${GREEN}Starting in development mode...${NC}"
        npx tsx watch src/bridge/server.ts
        exit 0
        ;;
esac

main
