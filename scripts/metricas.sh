#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# MARCADOR DE DEUDA VISUAL — ST Perfumería
#
# Cuatro números que sólo pueden bajar. Corré esto antes y después de
# cada sesión de limpieza para ver el avance:  npm run metricas
#
# Línea de base (5-sep-2026, antes de Fase 1):
#   !important 452 · inline 887 · admin.html 503 KB · controles chicos 4
# ══════════════════════════════════════════════════════════════════
cd "$(dirname "$0")/.." || exit 1

imp=$(grep -o '!important' css/styles.css | wc -l | tr -d ' ')
inl=$(grep -o 'style="' admin.html | wc -l | tr -d ' ')
kb=$(( $(wc -c < admin.html) / 1024 ))

barra() { # $1 actual  $2 base  $3 objetivo
  local pct=$(( $2 > $3 ? (($2 - $1) * 100) / ($2 - $3) : 0 ))
  [ "$pct" -lt 0 ] && pct=0; [ "$pct" -gt 100 ] && pct=100
  local n=$(( pct / 5 )); local i=0; local b=""
  while [ $i -lt 20 ]; do [ $i -lt $n ] && b="${b}█" || b="${b}·"; i=$((i+1)); done
  printf "%s %3d%%" "$b" "$pct"
}

echo ""
echo "  MARCADOR DE DEUDA VISUAL          $(date +%d-%m-%Y)"
echo "  ──────────────────────────────────────────────────────────"
printf "  !important en styles.css   %5s   (base 452 → meta 50)   %s\n" "$imp" "$(barra "$imp" 452 50)"
printf "  style= inline en admin      %5s   (base 887 → meta 200)  %s\n" "$inl" "$(barra "$inl" 887 200)"
printf "  peso de admin.html        %5s KB  (base 503 → meta 150)  %s\n" "$kb" "$(barra "$kb" 503 150)"
echo "  ──────────────────────────────────────────────────────────"
echo "  Los controles < 44px se miden en el navegador, no acá."
echo ""
