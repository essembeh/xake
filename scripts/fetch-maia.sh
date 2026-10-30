#!/bin/sh
# Fetch the Maia opponent assets (ONNX Runtime Web + 9 networks, ~46 MB, spec 006) into a vendor
# directory, checked against pinned SHA-256. Too big to be committed: run by `just webapp` and the image build.
set -eu

VENDOR=${1:-$(cd "$(dirname "$0")/.." && pwd)/src/xake/static/vendor}

ONNXRUNTIME_VERSION=1.31.1
ONNXRUNTIME_SHA256=bdccdb9fbb9ab537247c0c734e9b1d2b1b338b4f2a09faa58f0dc1cfa27c312c
# Maia 1 weights converted to ONNX (GPL-3.0, CSSLab/maia-chess), pinned revision
MAIA_REPO=https://huggingface.co/cstr/maia-chess-onnx-opset15/resolve/922d3659cdbab3168bb52b06d2a43b41872dd798
MAIA_SHA256="
27d476fd308b62974f321270e0c4149ebb6c7e381fc796a65d85d92dcab487fa  maia-1100.onnx
f72bacb6311f7e346a33c8f3c17b6950113cdccdb5462b8466d154f4adf194ad  maia-1200.onnx
e7eabae14e718ecba1572284fe9c5d1aa095c9eecce4a054d84c1884600eabed  maia-1300.onnx
bd55ed6a12b4953f807295657f4ee12775923a96580999511863004ab12a0d88  maia-1400.onnx
5dcbcf9badb4202846e1f2fcade9c6d066f175552e74468ecd4c769aa8a16fb9  maia-1500.onnx
3b35c2f77ce4f93170286b87ae5a7fa3a871ac3a7d94ac956105b640440af79e  maia-1600.onnx
7090704723221ddbe104bc1a08d9cd1d218235328f5ddfcfa23fde0b193c8155  maia-1700.onnx
cbf1e98e02dad263508c3b943361e7e43f0e28e12903ab5db953cded1ab0ebee  maia-1800.onnx
f72492271f6476cd249546b3d790b35db50107a0623a5a08066bf7b28ea04e72  maia-1900.onnx
"

mkdir -p "$VENDOR/onnxruntime" "$VENDOR/maia"

if [ ! -f "$VENDOR/onnxruntime/ort-wasm-simd-threaded.wasm" ]; then
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    curl -fsSL -o "$TMP/ort.tgz" "https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-$ONNXRUNTIME_VERSION.tgz"
    echo "$ONNXRUNTIME_SHA256  $TMP/ort.tgz" | sha256sum -c >/dev/null
    tar xzf "$TMP/ort.tgz" -C "$TMP"
    cp "$TMP/package/dist/ort.wasm.min.mjs" "$TMP/package/dist/ort-wasm-simd-threaded.mjs" \
        "$TMP/package/dist/ort-wasm-simd-threaded.wasm" "$VENDOR/onnxruntime/"
    # The npm package ships no licence file: MIT, from the release tag
    curl -fsSL -o "$VENDOR/onnxruntime/LICENSE" \
        "https://raw.githubusercontent.com/microsoft/onnxruntime/v$ONNXRUNTIME_VERSION/LICENSE"
fi

cd "$VENDOR/maia"
echo "$MAIA_SHA256" | while read -r sum name; do
    [ -n "$name" ] || continue
    if ! echo "$sum  $name" | sha256sum -c >/dev/null 2>&1; then
        curl -fsSL -o "$name" "$MAIA_REPO/$name"
        echo "$sum  $name" | sha256sum -c >/dev/null
    fi
done
echo "Maia assets ready in $VENDOR (onnxruntime-web $ONNXRUNTIME_VERSION, 9 networks)"
