# Multi-stage build for efficient Docker image
FROM node:20-alpine AS builder

# Install system dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set up Playwright environment
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies for build (including devDependencies)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine as production

# Install system dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set up Playwright environment
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create app directory and user
WORKDIR /app
RUN addgroup -g 1001 -S nodejs
RUN adduser -S mcpserver -u 1001

# Copy package files for production install
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder --chown=mcpserver:nodejs /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: '0.0.0.0', port: 3001, path: '/health', timeout: 2000 }; const request = http.request(options, (res) => { if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } }); request.on('error', () => process.exit(1)); request.end();"

# Switch to non-root user
USER mcpserver

# Start the application
CMD ["node", "dist/streamable-server.js"]