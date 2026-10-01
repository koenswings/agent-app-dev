#!/usr/bin/env bash
# Import a Khan Academy EN-US topic slice into a Running Kolibri.
# Public channel — no Studio token.
#
# Usage:
#   ./import-khan-topic-slice.sh form3          # Variables & expressions topic
#   ./import-khan-topic-slice.sh g5a            # Add and subtract fractions topic
#   ./import-khan-topic-slice.sh form3 leaves   # 3V+3E only
#   CONTAINER=idea166-khan-dryrun ./import-khan-topic-slice.sh form3 leaves
#
set -euo pipefail
CHANNEL=c9d7f950ab6b5a1199e3d6c10d7f0103
PACK=${1:-}
MODE=${2:-topic}   # topic | leaves
CONTAINER=${CONTAINER:-}
# Image koenswings/kolibri:1.0-0.15.5-dev ships ./kolibri-0.15.5 (not on PATH as "kolibri")
KOLIBRI_BIN=${KOLIBRI_BIN:-}
if [[ -z "$KOLIBRI_BIN" ]]; then
  if [[ -n "${CONTAINER:-}" ]]; then
    KOLIBRI_BIN=./kolibri-0.15.5
  elif command -v kolibri >/dev/null 2>&1; then
    KOLIBRI_BIN=kolibri
  elif [[ -x ./kolibri-0.15.5 ]]; then
    KOLIBRI_BIN=./kolibri-0.15.5
  else
    KOLIBRI_BIN=kolibri
  fi
fi

case "$PACK" in
  form3|Form3|f3)
    TOPIC=0f21619fbd75505f92bd96184b07b46d
    LEAVES=b3677df2bf9e5e5fa1f19e57a2f26b97,fcba0a76d6075c02b1f9f7742847a4c4,7f1b54804b2e5d81b7670d383cf341a8,a484d2921dd35f428d087b61a8e82416,d455f572cc3355b08c982a997d412aa8,8c88069407945913918b90523c2ac8ca
    LABEL="Form3 Variables & expressions"
    ;;
  g5a|G5A|grade5a)
    TOPIC=4a5b44d4826e511b8bb2e568b9562c5c
    LEAVES=ef35763056fe5113946710a750e4e75c,43d4efc489e150b19a3b7a7460e30fd9,cbb99d491f405719b44f1e6d12380c3f,0ed1af8fbbe758bbb743168938dc8a38,1d4c27c6d3bd59e0bd87fdb59eb68a2b,23e0467261d65705bd6de61adb6dbbec
    LABEL="G5A Add and subtract fractions"
    ;;
  *)
    echo "Usage: $0 {form3|g5a} [topic|leaves]" >&2
    exit 2
    ;;
esac

NODES="$TOPIC"
[[ "$MODE" == "leaves" ]] && NODES="$LEAVES"

run() {
  if [[ -n "$CONTAINER" ]]; then
    docker exec "$CONTAINER" $KOLIBRI_BIN manage "$@"
  else
    $KOLIBRI_BIN manage "$@"
  fi
}

echo "==> $LABEL  channel=$CHANNEL  mode=$MODE  nodes=$NODES"
echo "==> importchannel (metadata ~115MB)"
run importchannel network "$CHANNEL"
echo "==> importcontent --node_ids"
run importcontent --node_ids "$NODES" network "$CHANNEL"
echo "==> done (no full 68GB import)"
