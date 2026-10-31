# Static site (spec 007): Node builds it, nginx serves it. Pinned versions, bumped with the npm dependencies.
ARG NODE_VERSION=24
ARG NGINX_VERSION=1.31

#########################################
## Stage: build — npm ci, then the Vite build with the Maia networks (fetched, SHA-256 checked)
FROM node:${NODE_VERSION}-alpine AS build

RUN apk add --no-cache curl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build


#########################################
## Stage: webapp — nginx, non-root, port 8000
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS webapp

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-xake-config.sh /docker-entrypoint.d/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8000
