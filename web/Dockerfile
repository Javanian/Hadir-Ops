# Production web tier: the dashboard and the mobile app's web build, served by
# Caddy, which also terminates HTTPS and proxies /api to the backend (see Caddyfile).
#
# Needs the mobile app as a second build context:
#   docker build --build-context mobile=../mobile .
# (docker-compose.prod.yml and CI pass it.)

# The mobile app for browsers at /app, for employees without the native app
# and for the public demo. Same origin as /api, so no CORS.
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS mobile-web
WORKDIR /mobile
COPY --from=mobile package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY --from=mobile . .
ENV EXPO_PUBLIC_API_BASE_URL=/api
RUN npx expo export --platform web --output-dir /out

FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Exactly the locked versions, and no install scripts run during the build.
RUN npm ci --ignore-scripts
COPY . .
# The API lives on the same origin under /api, so no CORS and no URL to bake in.
ENV VITE_API_BASE_URL=/api VITE_APP_NAME=Rollproof
RUN npm run build

FROM caddy:2.11.7-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY --from=mobile-web /out /srv/app
