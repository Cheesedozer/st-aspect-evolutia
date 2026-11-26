#!/bin/bash
cd "$(dirname "$0")"
for t in t01 t01p t02 t03 t04 t05 t07 t08 t09 t10 t11 t12 t13 t14 t15 t16 t16b; do
  out=$(timeout 400 node $t.mjs 2>&1)
  if echo "$out" | grep -q "ALL PASS"; then r=PASS; elif echo "$out" | grep -q "SOME FAILED"; then r=FAIL; else r=INFO; fi
  echo "$t $r"
  [ "$r" != PASS ] && echo "$out" | grep -v DEPRECATED | tail -8 | sed 's/^/    /'
done
