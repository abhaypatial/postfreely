#!/usr/bin/env sh
set -eu

SUPABASE_URL="${POSTFREELY_SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${POSTFREELY_SUPABASE_ANON_KEY:-}"
PUBLIC_URL="${POSTFREELY_PUBLIC_URL:-}"
ENABLE_GOOGLE_AUTH="${POSTFREELY_ENABLE_GOOGLE_AUTH:-true}"

cat > frontend/assets/js/core/site-config.js <<EOF
window.POSTFREELY_CONFIG = {
  mode: "supabase",
  supabaseUrl: "${SUPABASE_URL}",
  supabaseAnonKey: "${SUPABASE_ANON_KEY}",
  publicUrl: "${PUBLIC_URL}",
  enableGoogleAuth: ${ENABLE_GOOGLE_AUTH},
  proxyUrl: "",
  aiUrl: ""
};
EOF
