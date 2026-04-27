################################
# Build stage
################################
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY templates ./templates
RUN npm run build

# Prune dev deps for the runtime image
RUN npm prune --omit=dev

################################
# Runtime stage
################################
FROM node:20-alpine AS runtime
WORKDIR /app

# `unzip` and `git` are used by the input materialiser (kind:"zip" / "git").
RUN apk add --no-cache unzip git tini

ENV NODE_ENV=production \
    PORT=4200 \
    SEL2PW_WORK_DIR=/var/sel2pw

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates
COPY package.json ./

RUN mkdir -p /var/sel2pw && chown -R node:node /var/sel2pw
USER node

EXPOSE 4200

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
