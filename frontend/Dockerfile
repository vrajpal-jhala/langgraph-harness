FROM node:26.13.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG GITLAB_API_URL
ARG GITHUB_API_URL
RUN GITLAB_API_URL=$GITLAB_API_URL GITHUB_API_URL=$GITHUB_API_URL npm run build

FROM nginx:1.31.10-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
