# Build: make -C tools/re/capture   (output: tools/re/capture/build/gba-capture)
MGBA_PREFIX ?= /opt/homebrew
CC ?= cc
SRC_SHA := $(shell shasum capture.c | cut -c1-12)
CFLAGS ?= -O2 -g -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers
CPPFLAGS += -I$(MGBA_PREFIX)/include -DHARNESS_SRC_SHA=\"$(SRC_SHA)\"
LDFLAGS += -L$(MGBA_PREFIX)/lib -Wl,-rpath,$(MGBA_PREFIX)/lib
LDLIBS += -lmgba -lm

build/gba-capture: capture.c Makefile
	@mkdir -p build
	$(CC) $(CFLAGS) $(CPPFLAGS) capture.c -o $@ $(LDFLAGS) $(LDLIBS)

clean:
	rm -rf build
.PHONY: clean
