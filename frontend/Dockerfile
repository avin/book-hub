FROM node:24-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts

COPY frontend ./

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

RUN npm run build

FROM nginx:1.27-alpine

# pdf.js worker is shipped as .mjs; without this nginx serves it as application/octet-stream
# and the browser rejects it as a module script.
RUN sed -i 's/application\/javascript\s\+js;/application\/javascript  js mjs;/' /etc/nginx/mime.types

COPY --from=build /app/dist /usr/share/nginx/html/app
COPY frontend/nginx/40-book-hub-config.sh /docker-entrypoint.d/40-book-hub-config.sh
COPY frontend/nginx/templates /etc/book-hub/nginx/templates

RUN chmod +x /docker-entrypoint.d/40-book-hub-config.sh

EXPOSE 80
