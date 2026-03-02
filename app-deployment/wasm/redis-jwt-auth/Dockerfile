FROM tinygo/tinygo:0.33.0

WORKDIR /work

# Copy source files
COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./

# Build Wasm binary
RUN tinygo build -o redis-jwt-auth.wasm \
    -scheduler=none \
    -target=wasi \
    .

# Output will be in /work/redis-jwt-auth.wasm
# When run with -v $(pwd):/work, it will appear in host directory
