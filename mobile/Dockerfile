# Development only: runs the Metro bundler for Expo Go / dev builds on the LAN.
# Release apps are built with EAS (eas.json), not from this image.
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94

WORKDIR /app

# Dependencies first (cached layer), exactly as locked
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Metro
EXPOSE 8081

CMD ["npx", "expo", "start", "--lan"]
