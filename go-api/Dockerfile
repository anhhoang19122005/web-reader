FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /reader-api ./cmd/local

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
# Same Piper release and models as the Windows launcher; Linux amd64 only.
RUN set -eu; curl -fsSL --retry 3 https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
      -o /tmp/piper.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /opt \
    && rm /tmp/piper.tar.gz \
    && mkdir -p /opt/piper/voices \
    && for name in duy_oryx.onnx duy_oryx.onnx.json ngoc_ngan.onnx ngoc_ngan.onnx.json; do \
      curl -fSL --retry 3 "https://huggingface.co/datasets/lamyaya88a/tts-ngochuyen-v1/resolve/main/$name" \
        -o "/opt/piper/voices/$name"; \
    done
ENV PORT=8081 \
    PIPER_ENABLED=true \
    PIPER_BIN=/opt/piper/piper \
    PIPER_ESPEAK_DATA=/opt/piper/espeak-ng-data \
    PIPER_DUYORYX_MODEL=/opt/piper/voices/duy_oryx.onnx \
    PIPER_DUYORYX_CONFIG=/opt/piper/voices/duy_oryx.onnx.json \
    PIPER_NGOCNGAN_MODEL=/opt/piper/voices/ngoc_ngan.onnx \
    PIPER_NGOCNGAN_CONFIG=/opt/piper/voices/ngoc_ngan.onnx.json \
    LD_LIBRARY_PATH=/opt/piper
RUN useradd --create-home --uid 10001 reader
COPY --from=build /reader-api /usr/local/bin/reader-api
USER reader
WORKDIR /home/reader
EXPOSE 8081
CMD ["reader-api"]
