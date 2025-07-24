# Define the output binary name
BINARY = cloudflare-speedtest

# Default target to compile the CLI tool
all: $(BINARY)

$(BINARY): cli.js
	deno compile --unstable-detect-cjs --allow-net --output=$@ $<

clean:
	rm -f $(BINARY)
