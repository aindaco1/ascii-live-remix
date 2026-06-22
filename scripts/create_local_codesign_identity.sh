#!/usr/bin/env bash
set -euo pipefail

IDENTITY="${ASCILINE_LOCAL_CODESIGN_IDENTITY:-ASCII VJ Remix Local Code Signing}"
KEYCHAIN="${ASCILINE_LOCAL_CODESIGN_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

if /usr/bin/security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -F "\"$IDENTITY\"" >/dev/null; then
  echo "ASCILINE local codesign: identity already exists: $IDENTITY"
  echo "Use it with: ASCILINE_CODESIGN_IDENTITY=\"$IDENTITY\" npm run desktop:run-local"
  exit 0
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cat > "$TMP_DIR/openssl.cnf" <<EOF
[ req ]
prompt = no
distinguished_name = dn
x509_extensions = ext

[ dn ]
CN = $IDENTITY

[ ext ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
EOF

/usr/bin/openssl req \
  -new \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -sha256 \
  -days 3650 \
  -keyout "$TMP_DIR/key.pem" \
  -out "$TMP_DIR/cert.pem" \
  -config "$TMP_DIR/openssl.cnf"

/usr/bin/openssl pkcs12 \
  -export \
  -inkey "$TMP_DIR/key.pem" \
  -in "$TMP_DIR/cert.pem" \
  -out "$TMP_DIR/cert.p12" \
  -passout pass:

/usr/bin/security import "$TMP_DIR/cert.p12" \
  -k "$KEYCHAIN" \
  -P "" \
  -T /usr/bin/codesign

if ! /usr/bin/security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP_DIR/cert.pem"; then
  echo "ASCILINE local codesign: imported identity, but macOS did not add explicit trust automatically." >&2
  echo "Open Keychain Access and trust '$IDENTITY' for Code Signing if codesign verification complains." >&2
fi

if ! /usr/bin/security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "\"$IDENTITY\"" >/dev/null; then
  echo "ASCILINE local codesign: identity import completed, but codesign did not list it as valid." >&2
  exit 1
fi

echo "ASCILINE local codesign: created $IDENTITY"
echo "Use it with: ASCILINE_CODESIGN_IDENTITY=\"$IDENTITY\" npm run desktop:run-local"
