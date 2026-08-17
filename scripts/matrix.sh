#!/usr/bin/env bash
# Build and test the addon across the supported Node versions, and optionally
# across architectures.
#
#   ./scripts/matrix.sh                        # host arch, Node 22/24/26
#   NODE_VERSIONS="26" ./scripts/matrix.sh     # one version
#   PLATFORMS="linux/amd64 linux/arm64" ./scripts/matrix.sh
#
# Exits non-zero if any cell fails.
set -uo pipefail

cd "$(dirname "$0")/.."

NODE_VERSIONS="${NODE_VERSIONS:-22 24 26}"
PLATFORMS="${PLATFORMS:-}"

declare -a RESULTS=()
FAILED=0

run_cell() {
  local nv="$1" platform="$2" tag plat_args label
  if [ -n "$platform" ]; then
    tag="mmmagic:node${nv}-$(echo "$platform" | tr '/' '-')"
    plat_args=(--platform "$platform")
    label="node${nv} ${platform}"
  else
    tag="mmmagic:node${nv}"
    plat_args=()
    label="node${nv} (host arch)"
  fi

  echo "=============================================================="
  echo "  BUILD  ${label}"
  echo "=============================================================="
  # ${arr[@]+"${arr[@]}"} — expanding an empty array under `set -u` is an error
  # in bash 3.2, which is what macOS ships.
  if ! docker build ${plat_args[@]+"${plat_args[@]}"} \
        -f docker/Dockerfile \
        --build-arg "NODE_VERSION=${nv}" \
        --progress=plain \
        -t "$tag" . ; then
    RESULTS+=("FAIL(build)  ${label}")
    FAILED=1
    return
  fi

  echo "=============================================================="
  echo "  TEST   ${label}"
  echo "=============================================================="
  if docker run --rm ${plat_args[@]+"${plat_args[@]}"} "$tag"; then
    RESULTS+=("PASS         ${label}")
  else
    RESULTS+=("FAIL(test)   ${label}")
    FAILED=1
  fi
}

if [ -n "$PLATFORMS" ]; then
  for platform in $PLATFORMS; do
    for nv in $NODE_VERSIONS; do run_cell "$nv" "$platform"; done
  done
else
  for nv in $NODE_VERSIONS; do run_cell "$nv" ""; done
fi

echo
echo "=============================================================="
echo "  MATRIX SUMMARY"
echo "=============================================================="
printf '  %s\n' "${RESULTS[@]}"
exit $FAILED
