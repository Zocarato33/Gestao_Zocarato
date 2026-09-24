FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    APP_TZ=America/Sao_Paulo
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
