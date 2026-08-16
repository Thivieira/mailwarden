FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Run migrations and start server
EXPOSE 3000
CMD ["bun", "run", "start"]
