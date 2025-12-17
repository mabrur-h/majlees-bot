# Multi-stage build for Telegram Bot with Local Bot API support
# Stage 1: Build telegram-bot-api
FROM alpine:3.19 AS telegram-bot-api-builder

RUN apk add --no-cache \
    alpine-sdk \
    linux-headers \
    git \
    zlib-dev \
    openssl-dev \
    gperf \
    cmake

WORKDIR /build

# Clone and build telegram-bot-api
RUN git clone --recursive https://github.com/tdlib/telegram-bot-api.git && \
    cd telegram-bot-api && \
    mkdir build && \
    cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX:PATH=/usr/local .. && \
    cmake --build . --target install -j $(nproc)

# Stage 2: Build Node.js application
FROM node:20-alpine AS node-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine

# Install runtime dependencies for telegram-bot-api
RUN apk add --no-cache \
    libstdc++ \
    openssl \
    supervisor

WORKDIR /app

# Copy telegram-bot-api binary
COPY --from=telegram-bot-api-builder /usr/local/bin/telegram-bot-api /usr/local/bin/

# Copy Node.js application
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package.json ./

# Copy public folder (for images etc)
COPY --from=node-builder /app/public ./public

# Create directories for telegram-bot-api
RUN mkdir -p /var/lib/telegram-bot-api /var/log

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisord.conf

# Environment variables
ENV NODE_ENV=production
ENV USE_LOCAL_BOT_API=true
ENV LOCAL_BOT_API_URL=http://localhost:8081

# Expose ports
# 8081 - Local Bot API
# 3001 - Webhook server (if used)
EXPOSE 8081 3001

# Start both services using supervisor
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
