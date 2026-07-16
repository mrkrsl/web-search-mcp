# Stage 1: Build the application
FROM oven/bun:canary AS builder
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN bun install

# Bundle app source
COPY . .
RUN bun build ./src/index.ts --outdir dist --packages external --target bun --minify
RUN bun build ./src/api.ts --outdir dist --packages external --target bun --minify

# Stage 2: Production
FROM oven/bun:slim
WORKDIR /usr/src/app

# Install Playwright browsers AND their OS-level dependencies (X11, GTK, fonts, etc.)
RUN apt-get update && \
    bunx playwright install --with-deps firefox && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/src/app/dist/index.js .
COPY --from=builder /usr/src/app/dist/api.js .

# Start the API server by default (use "bun index.js" for MCP stdio mode)
ENV PORT=3000
EXPOSE $PORT
CMD ["bun", "api.js"]