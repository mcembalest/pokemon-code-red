#!/usr/bin/env bash
# Content version of the core: changes iff an input to core/build.sh changes.
cd "$(dirname "$0")" && cat adapter.inc mgba.patch retroarch.patch sources.lock.json build.sh | sha256sum | cut -c1-12
