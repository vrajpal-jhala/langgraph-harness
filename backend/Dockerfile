FROM node:22-slim AS builder
# 'builder' stage is also used by the db-migrate and db-baseline compose services
WORKDIR /app
COPY package*.json ./
COPY patches ./patches
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/build ./build
COPY package*.json ./
COPY patches ./patches
COPY .env.example ./
RUN npm ci --omit=dev
EXPOSE 3698
CMD ["node", "./build/index.js"]
