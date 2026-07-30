#!/usr/bin/env bash
# Fetch a FREE ("name your own price") upload from an itch.io asset page.
# usage: itch-fetch.sh <user> <game> <out-dir> [upload-name-substring]
set -euo pipefail
USER_="$1"; GAME="$2"; OUT="$3"; WANT="${4:-}"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
JAR="$(mktemp)"; PAGE="$(mktemp)"; DLP="$(mktemp)"
BASE="https://${USER_}.itch.io/${GAME}"
mkdir -p "$OUT"

curl -fsSL -c "$JAR" -A "$UA" "$BASE" -o "$PAGE"
CSRF=$(grep -oE 'csrf_token" value="[^"]+' "$PAGE" | head -1 | sed 's/.*value="//')
[ -n "$CSRF" ] || { echo "no csrf token on $BASE" >&2; exit 1; }

DLURL=$(curl -fsS -b "$JAR" -c "$JAR" -A "$UA" -H 'X-Requested-With: XMLHttpRequest' \
  -H "Referer: $BASE" --data-urlencode "csrf_token=$CSRF" "$BASE/download_url" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.url){console.error(d);process.exit(1)}console.log(j.url)})")

curl -fsSL -b "$JAR" -c "$JAR" -A "$UA" "$DLURL" -o "$DLP"
CSRF2=$(grep -oE 'csrf_token" value="[^"]+' "$DLP" | head -1 | sed 's/.*value="//')

# upload rows: data-upload_id + the <strong title="..."> filename that follows it
node -e '
const fs=require("fs"); const h=fs.readFileSync(process.argv[1],"utf8");
const ids=[...h.matchAll(/data-upload_id="(\d+)"/g)].map(m=>m[1]);
const names=[...h.matchAll(/<strong title="([^"]+)" class="name"/g)].map(m=>m[1]);
ids.forEach((id,i)=>console.log(id+"\t"+(names[i]||("upload-"+id))));
' "$DLP" > "$OUT/.uploads.tsv"
cat "$OUT/.uploads.tsv" >&2

while IFS=$'\t' read -r ID NAME; do
  [ -n "$ID" ] || continue
  if [ -n "$WANT" ] && [[ "$NAME" != *"$WANT"* ]]; then continue; fi
  if [ -s "$OUT/$NAME" ]; then echo "  cached $NAME" >&2; continue; fi
  URL=$(curl -fsS -b "$JAR" -c "$JAR" -A "$UA" -H 'X-Requested-With: XMLHttpRequest' \
    -H "Referer: $DLURL" --data-urlencode "csrf_token=$CSRF2" \
    "$BASE/file/$ID?source=game_download&as_props=1&after_download_lightbox=true" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.url||'')})")
  [ -n "$URL" ] || { echo "no url for upload $ID ($NAME)" >&2; continue; }
  echo "-> $NAME" >&2
  curl -fsSL -A "$UA" "$URL" -o "$OUT/$NAME"
done < "$OUT/.uploads.tsv"
rm -f "$JAR" "$PAGE" "$DLP"
