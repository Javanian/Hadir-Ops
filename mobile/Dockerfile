FROM node:20-alpine

# Required for Expo / React Native native deps
RUN apk add --no-cache bash

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy project files
COPY . .

EXPOSE 8081
EXPOSE 19000
EXPOSE 19001

CMD ["npx", "expo", "start", "--lan"]
