# Brawl Engine: Spiel + Multiplayer-Server + SQLite-Datenbank
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/kistenkrawall.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
# Die Datenbank liegt in einem Volume, damit sie Updates überlebt
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
