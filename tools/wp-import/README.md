# WordPress import scripts

One-shot scripts used to migrate ultimatesmiles.com into this repo. Kept because the migration is
re-runnable: if the source site changes, regenerate rather than hand-editing 150 pages.

They are **not** part of the build. `wp-migrator/` is the general tool; these fill the gaps it has.

## Why these exist

`wp-migrator` reads a live URL and a WXR XML. It cannot read `.wpress`, and this site's WXR export
contains posts and attachments but **no pages**. All page content therefore comes from the MariaDB
dump inside the `.wpress` archive.

## Order

```bash
SC=<scratchpad>            # working dir for intermediate JSON
ARCHIVE=site/*.wpress

python3 wpress.py list "$ARCHIVE"                    # inspect
python3 extract.py "$ARCHIVE" uploads   $SC/wpress-out   # 2409 files
python3 extract.py "$ARCHIVE" .         $SC/wpress-db    # database.sql

python3 dbpages.py $SC        # -> db-pages.json, db-posts.json
python3 yoast.py   $SC        # -> yoast.json (298 SEO records)
python3 nav.py     $SC        # -> nav.json   (97 menu items)

python3 parse_sections.py $SC                       # -> parsed-pages.json
python3 gen_pages.py      $SC src/content/pages --write
python3 gen_snap_pages.py $SC --write               # theme-rendered pages, needs .wpmig/static
python3 gen_posts.py      $SC src/content/blog  --write
```

`gen_*.py` default to a dry run; `--write` applies.

## Gotchas

- `.wpress` paths carry an 8-hex-char suffix per segment (`uploadsf3e5905b`) — strip it.
- DB tables are prefixed `SERVMASK_PREFIX_`, a placeholder, not the real prefix.
- `posts.menu_order` is column 19, not 18 (18 is `guid`).
- Placeholders like `<<URLYelp>>` are stored entity-encoded (`&lt;&lt;`).
- MDX treats `<` and `{` as JSX; `gen_posts.py` escapes them.
- Cluster pages on their ordered `section-block` signature, never on raw content similarity.
