# Define the output binary name
BINARY = speed-cloudflare-cli

# Any args to use when testing
ARG ?= ""

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
	./$(BINARY) $(ARG)

check: eslint prettier editorconfig

fix: eslint-fix prettier-fix editorconfig-fix

eslint-fix:
	npx eslint --fix .

eslint:
	npx eslint .

prettier-fix:
	npx prettier --write .

prettier:
	npx prettier --check .

editorconfig:
	git ls-files -z | xargs -0 grep -qPzlv '\x0a$' || echo "No CR at eof!"
	git ls-files -z | xargs -0 grep -ql '[[:space:]]$' || echo "EOL whitespace found!"

editorconfig-fix:
	git ls-files -z | xargs -0 grep -PzZlv "\x0a$$" | xargs -0 -I{} -n 1 sh -c 'echo >> {}'
	git ls-files -z | xargs -0 grep -PZl '[[:space:]]$$' | xargs -0 -I{} sed -i 's,[[:space:]]*$$,,' {}
