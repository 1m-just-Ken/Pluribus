#!/bin/bash
# ============================================================
# PLURIBUS — Start
# One command. No API keys. No excuses.
# ============================================================

set -e

echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║         P L U R I B U S           ║"
echo "  ║       E Pluribus Unum             ║"
echo "  ╚═══════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  Node.js 18+ is required."
    echo "  Install: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "  Node.js 18+ required. You have $(node -v)"
    exit 1
fi

# Create .env if missing
if [ ! -f .env ]; then
    echo "  Creating default config (Bonsai 1-bit, no API keys)..."
    cat > .env << 'EOF'
LLM_PROVIDER=bonsai
BONSAI_MODEL=bonsai:8b
PORT=3000
EOF
fi

# Source .env
set -a; source .env 2>/dev/null; set +a

# Install dependencies
if [ ! -d node_modules ]; then
    echo "  Installing dependencies..."
    npm install --no-fund --no-audit 2>&1 | tail -1
fi

# Install Playwright browser
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "/root/.cache/ms-playwright" ]; then
    echo "  Installing Chromium for browser automation..."
    npx playwright install chromium 2>&1 | tail -1
fi

# Check Ollama (required for Bonsai and Ollama providers)
PROVIDER="${LLM_PROVIDER:-bonsai}"
if [ "$PROVIDER" = "bonsai" ] || [ "$PROVIDER" = "ollama" ]; then
    if ! command -v ollama &> /dev/null; then
        echo ""
        echo "  Ollama is required to run Bonsai/local models."
        echo ""
        echo "  Install (one command):"
        echo "    curl -fsSL https://ollama.ai/install.sh | sh"
        echo ""
        echo "  Or use a cloud provider instead:"
        echo "    Edit .env and set LLM_PROVIDER=anthropic"
        echo ""
        exit 1
    fi

    # Start Ollama if not running
    if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "  Starting Ollama..."
        ollama serve &> /dev/null &
        sleep 2
    fi

    MODEL="${BONSAI_MODEL:-bonsai:8b}"
    if [ "$PROVIDER" = "bonsai" ]; then
        echo "  Engine: PrismML Bonsai 1-bit"
        echo "  Model:  $MODEL (1.15 GB, Apache 2.0)"
        echo "  Cost:   Free. Forever."
    fi
fi

# Create workspace
mkdir -p .pluribus/workspace

echo ""
echo "  Starting..."
echo ""

# Launch
exec node src/server/index.js
