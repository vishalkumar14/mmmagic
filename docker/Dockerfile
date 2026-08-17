# Reproducible native-build environment for mmmagic.
#
#   docker build -f docker/Dockerfile --build-arg NODE_VERSION=26 -t mmmagic:node26 .
#   docker run --rm mmmagic:node26
#
# Debian bookworm base (not alpine) on purpose: glibc + GNU toolchain is what
# libmagic's autoconf-era config headers were generated against, and gdb/strace
# are one apt-get away when a native build needs debugging.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm

# node-gyp's toolchain. The non-slim node images already carry most of this via
# buildpack-deps, but install it explicitly so the build never depends on what
# the base image happens to ship this month.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV npm_config_python=/usr/bin/python3
# Never swallow compiler output.
ENV npm_config_foreground_scripts=true

WORKDIR /app

# Dependency layer: nan + node-gyp only, so editing src/ or deps/ does not force
# a re-download. --ignore-scripts because there is nothing to compile yet.
COPY package.json ./
RUN npm install --ignore-scripts

# Pre-fetch this image's Node headers so the compile step below is offline.
RUN ./node_modules/.bin/node-gyp install

COPY . .

# The actual compile. --verbose keeps every warning visible.
RUN ./node_modules/.bin/node-gyp rebuild --verbose

CMD ["npm", "test"]
