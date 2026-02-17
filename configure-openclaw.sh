#!/bin/bash

# OpenClaw WeChat 插件安装和配置脚本
# 此脚本将配置 OpenClaw 使用本地 WeChat Bridge

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     OpenClaw WeChat 插件配置向导                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 检查 OpenClaw 是否安装
if ! command -v openclaw &> /dev/null; then
    echo "❌ 错误: 未找到 openclaw 命令"
    echo "   请先安装 OpenClaw: https://github.com/openclaw/openclaw"
    exit 1
fi

echo "✓ OpenClaw 已安装"
echo ""

# 获取 OpenClaw 配置目录
OPENCLAW_CONFIG_DIR="${HOME}/.config/openclaw"
if [ -d "${HOME}/.openclaw" ]; then
    OPENCLAW_CONFIG_DIR="${HOME}/.openclaw"
fi

echo "OpenClaw 配置目录: ${OPENCLAW_CONFIG_DIR}"
echo ""

# 获取当前项目路径
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "项目目录: ${PROJECT_DIR}"
echo ""

# 查找 OpenClaw 配置文件
CONFIG_FILE="${OPENCLAW_CONFIG_DIR}/config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="${OPENCLAW_CONFIG_DIR}/config.yml"
fi

echo "════════════════════════════════════════════════════════════"
echo ""
echo "📋 手动配置步骤:"
echo ""
echo "1. 安装 WeChat 插件:"
echo "   openclaw plugins install ${PROJECT_DIR}"
echo ""
echo "2. 编辑 OpenClaw 配置文件:"
echo "   ${CONFIG_FILE}"
echo ""
echo "3. 添加以下配置到 channels 部分:"
echo ""
cat << 'EOF'
channels:
  wechat:
    enabled: true
    bridgeUrl: "http://localhost:3001"
    webhookHost: "localhost"
    webhookPort: 18790
    webhookPath: "/webhook/wechat"
EOF
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
echo "🚀 启动步骤:"
echo ""
echo "1. 启动 Bridge 服务:"
echo "   cd ${PROJECT_DIR}"
echo "   ./start-bridge.sh"
echo ""
echo "2. 使用微信扫描二维码登录"
echo ""
echo "3. 启动 OpenClaw:"
echo "   openclaw"
echo ""
echo "════════════════════════════════════════════════════════════"
