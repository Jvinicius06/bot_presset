FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY bot.js db.js deploy-commands.js ./
RUN addgroup -S bot && adduser -S bot -G bot && chown -R bot:bot /app
USER bot
CMD ["node", "bot.js"]
