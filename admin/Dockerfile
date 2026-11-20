# 통합 백오피스 이미지. 빌드 컨텍스트는 admin/ 폴더다.
#   docker build -t admin admin/
FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.24-alpine AS server
WORKDIR /src
COPY server/go.mod ./
COPY server/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/admin .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/admin /app/admin
COPY --from=web /src/dist /app/web
ENV STATIC_DIR=/app/web
# Cloud Run 이 PORT 를 넘겨준다. 기본값은 8080.
EXPOSE 8080
ENTRYPOINT ["/app/admin"]
