FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/gestao.db \
    APP_TZ=America/Sao_Paulo
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
