.PHONY: build test vet fmt clean run

BIN := bin/modelica-backend
PKG := ./...

build:
	go build -o $(BIN) ./cmd/server

run: build
	./$(BIN)

test:
	go test $(PKG)

vet:
	go vet $(PKG)

fmt:
	go fmt $(PKG)

clean:
	rm -rf bin/
