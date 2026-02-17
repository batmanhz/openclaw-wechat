#!/bin/bash

# OpenClaw WeChat Plugin Installer
# Automates the installation and file copying process

set -e

# Increase timeout for npm install (10 minutes)
export CI_SERVER_TOTAL_TIMEOUT=600000
export npm_config_fetch_timeout=600000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     OpenClaw WeChat Plugin Installer                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for OpenClaw CLI
if ! command -v openclaw &> /dev/null; then
    echo -e "${RED}Error: 'openclaw' command not found.${NC}"
    echo "Please install OpenClaw first: https://docs.openclaw.ai/install"
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ID="openclaw-wechat"
TARGET_DIR="$HOME/.openclaw/extensions/$EXTENSION_ID"

echo -e "${YELLOW}Installing plugin from current directory...${NC}"
openclaw plugins install "$PROJECT_DIR"

# Verify installation directory
if [ ! -d "$TARGET_DIR" ]; then
    # Try alternative directory name based on package scope
    ALT_DIR="$HOME/.openclaw/extensions/@canghe/openclaw-wechat"
    if [ -d "$ALT_DIR" ]; then
        TARGET_DIR="$ALT_DIR"
    else
        echo -e "${RED}Error: Could not find installed plugin directory at $TARGET_DIR${NC}"
        echo "Please verify the installation manually."
        exit 1
    fi
fi

echo -e "${GREEN}Plugin installed to: $TARGET_DIR${NC}"

echo -e "${YELLOW}Copying required files...${NC}"

# List of files/directories to copy
FILES_TO_COPY=(
    "src"
    "package.json"
    "tsconfig.json"
    "start-bridge.sh"
    "setup.sh"
    "openclaw.plugin.json"
    ".env.example"
)

for file in "${FILES_TO_COPY[@]}"; do
    if [ -e "$PROJECT_DIR/$file" ]; then
        echo "  Copying $file..."
        cp -r "$PROJECT_DIR/$file" "$TARGET_DIR/"
    else
        echo -e "${YELLOW}  Warning: $file not found in source directory, skipping.${NC}"
    fi
done

echo -e "${YELLOW}Installing dependencies in extension directory (this may take a few minutes)...${NC}"
cd "$TARGET_DIR"
npm install --omit=dev --loglevel=progress

echo -e "${GREEN}"
echo "✅ Installation complete!"
echo "════════════════════════════════════════════════════════════"
echo -e "${NC}"
echo "Next steps:"
echo "1. Configure the plugin:"
echo "   openclaw config set channels.wechat.enabled true"
echo ""
echo "2. Restart OpenClaw Gateway:"
echo "   openclaw gateway restart"
echo ""
echo "3. Start the bridge service (in a separate terminal):"
echo "   cd $TARGET_DIR"
echo "   ./start-bridge.sh"
echo ""
