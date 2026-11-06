# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runner ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-adro-config.sh
RUN chmod +x /docker-entrypoint.d/40-adro-config.sh
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
