#!/usr/bin/env bash
#
# End-to-end smoke test against a running dev server.
#
#   npm run dev > /tmp/tf.log 2>&1 &
#   ./scripts/smoke.sh http://localhost:3000 admin 'ChangeMe!2024' /tmp/tf.log
#
# Checks THREE things, because HTTP status alone is not enough — React
# serialization errors (e.g. passing a Prisma Decimal to a Client Component)
# render a 200 while logging an error server-side:
#   1. every route returns 200
#   2. protected routes reject an anonymous caller
#   3. the server log contains no render or serialization errors
set -uo pipefail

BASE="${1:-http://localhost:3000}"
USERNAME="${2:-admin}"
PASSWORD="${3:-ChangeMe!2024}"
LOGFILE="${4:-}"

JAR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$JAR" "$BODY"' EXIT

fail=0
pass=0

note() { printf '  %s\n' "$*"; }
ok()   { pass=$((pass+1)); printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { fail=$((fail+1)); printf '  \033[31m✗\033[0m %s\n' "$*"; }

echo
echo "── Anonymous access ──"
for path in /dashboard /projects /workspace/people; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  if [ "$code" = "307" ] || [ "$code" = "302" ]; then
    ok "$path redirects when signed out ($code)"
  else
    bad "$path returned $code while signed out — expected a redirect"
  fi
done

echo
echo "── Sign in ──"
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
if [ -z "$CSRF" ]; then
  bad "could not obtain a CSRF token — is the server running at $BASE?"
  exit 1
fi

curl -s -b "$JAR" -c "$JAR" -o /dev/null -X POST \
  "$BASE/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD"

ROLE=$(curl -s -b "$JAR" "$BASE/api/auth/session" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')
if [ -n "$ROLE" ]; then
  ok "signed in as $USERNAME ($ROLE)"
else
  bad "sign-in failed for $USERNAME — check the password"
  exit 1
fi

echo
echo "── Authenticated routes ──"
PROJECT_ID=$(curl -s -b "$JAR" "$BASE/api/auth/session" >/dev/null; \
  curl -s -b "$JAR" "$BASE/projects" | sed -n 's|.*href="/projects/\([a-z0-9]\{20,\}\)".*|\1|p' | head -1)

ROUTES=(/dashboard /my-tickets /activity /projects /projects/new /settings /settings/security)
[ "$ROLE" = "ADMIN" ] && ROUTES+=(/workspace/people /workspace/roles /workspace/teams /workspace/templates)

if [ -n "$PROJECT_ID" ]; then
  for view in board table tree calendar timeline insights recurring labels members settings activity; do
    ROUTES+=("/projects/$PROJECT_ID/$view")
  done
else
  note "no project found — skipping project views (seed the database first)"
fi

for path in "${ROUTES[@]}"; do
  code=$(curl -s -b "$JAR" -o "$BODY" -w '%{http_code}' "$BASE$path")
  if [ "$code" = "200" ]; then
    ok "$path"
  else
    bad "$path returned $code"
  fi
done

echo
echo "── Cron endpoint ──"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cron/recurring")
if [ "$code" = "401" ] || [ "$code" = "503" ]; then
  ok "rejects an unauthenticated sweep ($code)"
else
  bad "cron endpoint returned $code without a secret — expected 401"
fi

if [ -n "$LOGFILE" ] && [ -f "$LOGFILE" ]; then
  echo
  echo "── Server log ──"
  # These are the errors that hide behind a 200.
  hits=$(grep -cE "Only plain objects|Decimal objects|⨯ |Unhandled Runtime|MODULE_NOT_FOUND" "$LOGFILE" 2>/dev/null || true)
  hits=${hits:-0}
  if [ "$hits" -eq 0 ]; then
    ok "no render or serialization errors logged"
  else
    bad "$hits error line(s) in $LOGFILE — inspect it"
    grep -nE "Only plain objects|Decimal objects|⨯ |MODULE_NOT_FOUND" "$LOGFILE" | head -5 | sed 's/^/      /'
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m✅ %d checks passed\033[0m\n\n' "$pass"
else
  printf '\033[31m❌ %d passed, %d failed\033[0m\n\n' "$pass" "$fail"
fi
exit "$fail"
