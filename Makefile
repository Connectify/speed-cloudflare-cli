# Define the output binary name
BINARY = speed-cloudflare-cli

# Any args to use when testing
ARGS ?= ""

# Phony targets that don't correspond to files
.PHONY: test integration-test clean

# Default target to compile the CLI tool
all: $(BINARY)

$(BINARY): cli.js
	deno compile --unstable-sloppy-imports --unstable-detect-cjs --allow-net --output=$@ $<

clean:
	rm -f $(BINARY)

test:
	npm test

integration-test: $(BINARY)
	./$(BINARY) $(ARGS)

check: eslint prettier editorconfig

# No autofix is available yet.  See https://github.com/editorconfig-checker/editorconfig-checker/issues/14
fix: eslint-fix prettier-fix

eslint-fix:
	npx eslint --fix .

eslint:
	npx eslint .

prettier-fix:
	npx prettier --write .

prettier:
	npx prettier --check .

editorconfig:
	npx editorconfig-checker .
