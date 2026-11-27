FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node /var/lib/whoseiptv

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node config ./config
COPY --chown=node:node scripts ./scripts

ENV NODE_ENV=production \
    CATALOG_HOST=0.0.0.0 \
    CATALOG_PATH=/var/lib/whoseiptv/catalog.json \
    CATALOG_REFRESH_MINUTES=180 \
    CATALOG_WORLDWIDE=1 \
    PORT=8780

EXPOSE 8780
VOLUME ["/var/lib/whoseiptv"]
USER node
CMD ["node", "scripts/serve-season-catalog.mjs"]
