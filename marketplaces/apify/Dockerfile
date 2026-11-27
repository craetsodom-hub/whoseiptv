FROM node:24-bookworm-slim

WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && install -d -o node -g node /app/storage
COPY --chown=node:node actor.mjs ./

USER node
CMD ["npm", "start", "--silent"]
