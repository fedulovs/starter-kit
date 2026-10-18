#!/usr/bin/env bash
# Starts every service in the stack. Ctrl-C stops them all.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo; echo "$@" >&2; exit 1; }

# --- Java -------------------------------------------------------------------
# Any JDK 17 or newer works. The build targets Java 17 bytecode, so it does not
# matter if the JDK that compiles is newer than the one that runs.
if ! command -v java > /dev/null 2>&1; then
  die "No 'java' on PATH. Install a JDK 17 or newer (https://adoptium.net) and try again."
fi

java_major="$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')"
if [[ "$java_major" =~ ^[0-9]+$ ]] && (( java_major < 17 )); then
  die "Java $java_major found, but this needs 17 or newer. See https://adoptium.net"
fi

# --- Node -------------------------------------------------------------------
# Version managers put node on PATH from your shell profile, which a script does
# not load, so look a little harder before giving up.
load_node() {
  command -v npm > /dev/null 2>&1 && return 0

  for nvm_sh in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh /usr/local/opt/nvm/nvm.sh; do
    if [[ -s "$nvm_sh" ]]; then
      # shellcheck disable=SC1090
      . "$nvm_sh" > /dev/null 2>&1 || true
      # --silent with no argument picks up .nvmrc; fall back to whatever is there.
      nvm use --silent > /dev/null 2>&1 \
        || nvm use --silent default > /dev/null 2>&1 \
        || nvm use --silent node > /dev/null 2>&1 \
        || true
      command -v npm > /dev/null 2>&1 && return 0
    fi
  done

  if command -v fnm > /dev/null 2>&1; then
    eval "$(fnm env 2>/dev/null)" || true
    command -v npm > /dev/null 2>&1 && return 0
  fi
  if command -v mise > /dev/null 2>&1; then
    eval "$(mise env -s bash 2>/dev/null)" || true
    command -v npm > /dev/null 2>&1 && return 0
  fi

  for dir in "$HOME/.volta/bin" /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "$dir/npm" ]]; then
      PATH="$dir:$PATH"
      return 0
    fi
  done
  return 1
}

if ! load_node; then
  die "No 'npm' on PATH. Install Node 22 or newer (https://nodejs.org).
If you use nvm, fnm or similar, run 'nvm use' in this shell first."
fi

node_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major < 22 )); then
  echo "Warning: Node $node_major found; this was tested on 22 and newer." >&2
fi

# --- Ports ------------------------------------------------------------------
# A previous run that did not shut down cleanly otherwise shows up much later as
# an opaque BindException from whichever service lost the race.
busy=()
for port in 3000 4000 4101 4102 4103 4104; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
    exec 3<&- 2> /dev/null || true
    busy+=("$port")
  fi
done
if (( ${#busy[@]} > 0 )); then
  die "Ports already in use: ${busy[*]}
Something from an earlier run is probably still going. Stop it, or find it with:
  lsof -nP -iTCP:${busy[0]} -sTCP:LISTEN"
fi

# --- Dependencies -----------------------------------------------------------
if [[ ! -d storefront/node_modules ]]; then
  echo "Installing storefront dependencies (first run only)..."
  ( cd storefront && npm install --silent )
fi

echo "Building the Java services..."
./gradlew installDist -q --console=plain

# --- Run --------------------------------------------------------------------
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do kill "$pid" 2> /dev/null || true; done
}
trap cleanup EXIT INT TERM

./games/build/install/games/bin/games &
pids+=($!)

./platform/build/install/platform/bin/platform &
pids+=($!)

( cd storefront && npm start ) &
pids+=($!)

echo
echo "  ---------------------------------------------"
echo "   Open the store:  http://localhost:3000"
echo "  ---------------------------------------------"
echo
echo "   platform API     http://localhost:4000"
echo "   game backends    http://localhost:4101-4104"
echo
echo "  Ctrl-C stops everything."
echo
wait
