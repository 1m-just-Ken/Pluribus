FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    curl wget jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --no-fund --no-audit

# Install Playwright + Chromium
RUN npx playwright install --with-deps chromium

COPY . .

RUN mkdir -p .pluribus/workspace

EXPOSE 3000

CMD ["node", "src/server/index.js"]
