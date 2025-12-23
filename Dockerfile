# Use Node.js 20 LTS as base image
FROM node:24-slim

# Set working directory
WORKDIR /app

# Install system dependencies required for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    && rm -rf /var/lib/apt/lists/* \
    zip \
    unzip

# Create a non-root user for security
RUN useradd -m -u 1001 appuser
RUN usermod -aG sudo appuser
RUN echo 'appuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
RUN chown -R appuser:appuser /app

# Copy package files with proper ownership
COPY --chown=appuser:appuser package*.json ./

# Switch to non-root user
USER appuser

# Install Node.js dependencies (including dev dependencies needed for build)
# Using npm install instead of npm ci to handle potential lock file sync issues
# For production, ensure package-lock.json is up to date and use: npm ci
RUN npm install

# Install Playwright browsers (as non-root user)
RUN npx playwright install

# Copy source code with proper ownership
COPY --chown=appuser:appuser . .

# Build TypeScript to JavaScript
RUN npm run build

# Default to MCP server mode (can be overridden in docker-compose)
CMD ["node", "./dist/api.js"]

