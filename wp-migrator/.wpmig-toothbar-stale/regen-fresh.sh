#!/bin/bash
cd /Users/tharvey/Work/CloudCannon/toothbar/wp-migrator
while read -r p; do
  [ -z "$p" ] && continue
  node bin/wpmig.mjs dev-page "$p.html" --static .wpmig/static --target /Users/tharvey/Work/CloudCannon/toothbar --namespace wpmig >/dev/null 2>&1
done < .wpmig/all-pages.txt
echo "REGEN DONE" > .wpmig/regen-fresh.done
