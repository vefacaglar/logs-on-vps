FROM golang:1.26.3-alpine@sha256:91eda9776261207ea25fd06b5b7fed8d397dd2c0a283e77f2ab6e91bfa71079d AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /logs-browser .

FROM alpine:3.23@sha256:8169a308ae899f69285e7214b3c2de1c1f0f091ab228b87a58040c49d8cc2b0d
RUN addgroup -S logs && adduser -S -G logs logs
COPY --from=build /logs-browser /usr/local/bin/logs-browser
USER logs
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/logs-browser"]
