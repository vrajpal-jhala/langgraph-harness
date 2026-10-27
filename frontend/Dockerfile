FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG GITLAB_API_URL
ARG GITHUB_API_URL
ARG GITHUB_OAUTH_CLIENT_ID
RUN GITLAB_API_URL=$GITLAB_API_URL GITHUB_API_URL=$GITHUB_API_URL GITHUB_OAUTH_CLIENT_ID=$GITHUB_OAUTH_CLIENT_ID npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
