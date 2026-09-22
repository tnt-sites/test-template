#!/bin/bash
cd /Users/tharvey/Work/CloudCannon/toothbar/wp-migrator
: > .wpmig/generate-summary.txt
while read -r p; do
  [ -z "$p" ] && continue
  if node bin/wpmig.mjs dev-page "$p.html" --static .wpmig/static --target /Users/tharvey/Work/CloudCannon/toothbar --namespace wpmig > ".wpmig/gen-$p.log" 2>&1; then
    n=$(grep -c ' -> ' ".wpmig/gen-$p.log")
    shared=$(grep -c '(shared)' ".wpmig/gen-$p.log")
    echo "ok $p sections=$n shared=$shared" >> .wpmig/generate-summary.txt
  else
    echo "FAIL $p" >> .wpmig/generate-summary.txt
  fi
done < .wpmig/all-pages.txt
echo "GENERATION COMPLETE" >> .wpmig/generate-summary.txt
