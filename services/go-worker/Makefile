.PHONY: build run test lint clean tidy

build:
	go build -o bin/go-worker .

run: build
	./bin/go-worker

test:
	go test ./... -v -count=1

lint:
	golangci-lint run ./...

clean:
	rm -rf bin/

tidy:
	go mod tidy
