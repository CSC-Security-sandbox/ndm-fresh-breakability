.PHONY: build clean docker-build

# Build Wasm binary using TinyGo
build:
	@echo "Building Wasm extension with TinyGo..."
	tinygo build -o redis-jwt-auth.wasm \
		-scheduler=none \
		-target=wasi \
		.
	@echo "Build complete: redis-jwt-auth.wasm"
	@ls -lh redis-jwt-auth.wasm

# Build using Docker (ensures consistent environment)
docker-build:
	@echo "Building Wasm extension using Docker..."
	docker build -t redis-jwt-wasm-builder -f Dockerfile .
	@echo "Extracting Wasm binary from Docker image..."
	docker create --name temp-wasm-container redis-jwt-wasm-builder
	docker cp temp-wasm-container:/work/redis-jwt-auth.wasm ./redis-jwt-auth.wasm
	docker rm temp-wasm-container
	@echo "Build complete: redis-jwt-auth.wasm"
	@ls -lh redis-jwt-auth.wasm

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -f redis-jwt-auth.wasm
	@echo "Clean complete"

# Install TinyGo locally (macOS)
install-tinygo-mac:
	@echo "Installing TinyGo via Homebrew..."
	brew install tinygo

# Install TinyGo locally (Linux)
install-tinygo-linux:
	@echo "Installing TinyGo..."
	wget https://github.com/tinygo-org/tinygo/releases/download/v0.33.0/tinygo_0.33.0_amd64.deb
	sudo dpkg -i tinygo_0.33.0_amd64.deb
	rm tinygo_0.33.0_amd64.deb

# Verify build output
verify:
	@if [ ! -f redis-jwt-auth.wasm ]; then \
		echo "ERROR: redis-jwt-auth.wasm not found"; \
		exit 1; \
	fi
	@echo "Verification passed: redis-jwt-auth.wasm exists"
	@file redis-jwt-auth.wasm
