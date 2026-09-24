FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/gestao.db \
    APP_TZ=America/Sao_Paulo
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/data && chown -R node:node /app
EXPOSE 3000
VOLUME ["/app/data"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
