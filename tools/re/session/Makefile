MGBA_PREFIX ?= /opt/homebrew
CC ?= cc
CFLAGS ?= -O2 -g -Wall -Wextra -Wno-unused-parameter
build/gba-session: session.c Makefile
	@mkdir -p build
	$(CC) $(CFLAGS) -I$(MGBA_PREFIX)/include session.c -L$(MGBA_PREFIX)/lib -Wl,-rpath,$(MGBA_PREFIX)/lib -lmgba -o $@
.PHONY: clean
clean:
	rm -rf build
