FROM node:26.13.1-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:26.13.1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/build ./build
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 4100
CMD ["node", "./build/index.js"]
