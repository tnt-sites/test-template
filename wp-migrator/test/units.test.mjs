import assert from "node:assert/strict";
import test from "node:test";
import { initialsOf, isValidName, nameFromContent, nameFromShape, assertRoundTrips } from "../src/generate/names.mjs";
import { rewriteHref, useRouteMap } from "../src/generate/props.mjs";
import { collectAssetRefs } from "../src/generate/assets.mjs";
import { htmlToMarkdown, parseWxr } from "../src/content/posts.mjs";
import { repeatBlocks, partialKey, blockClasses, findSharedPartials, ownedClasses } from "../src/generate/partials.mjs";
import { textKey, diffTextNodes, severeFindings } from "../src/qa/pair-by-text.mjs";

const heading = (text) => ({ kind: "heading", text });

test("nameFromContent always returns a name the loader can register", () => {
  for (const text of ["24/7 Emergency Care", "2024 Awards", "1st Visit", "IV Sedation", "Call Us Today"]) {
    const name = nameFromContent(heading(text), "section");
    assert.ok(isValidName(name), `${text} -> ${name}`);
    assert.doesNotThrow(() => assertRoundTrips(name));
  }
});

test("nameFromContent drops leading digits rather than the whole heading", () => {
  assert.equal(nameFromContent(heading("24/7 Emergency Care"), "section"), "emergency-care");
});

test("nameFromContent falls back when nothing usable survives", () => {
  assert.equal(nameFromContent(heading("2024"), "section"), "section");
});

test("rewriteHref restores the source URL of a flattened page", () => {
  useRouteMap(new Map([["payment-options-dental-savers-plan", "/payment-options/dental-savers-plan/"]]));
  assert.equal(rewriteHref("payment-options-dental-savers-plan.html"), "/payment-options/dental-savers-plan/");
  assert.equal(rewriteHref("payment-options-dental-savers-plan.html#fees"), "/payment-options/dental-savers-plan/#fees");
  assert.equal(rewriteHref("index.html"), "/");
  assert.equal(rewriteHref("unknown-page.html"), "/unknown-page/");
  assert.equal(rewriteHref("https://example.com/x"), "https://example.com/x");
  assert.equal(rewriteHref("tel:7202222345"), "tel:7202222345");
  useRouteMap(new Map());
});

test("collectAssetRefs finds WordPress paths anywhere in the emitted output", () => {
  const refs = collectAssetRefs([
    { css: 'background-image: url("/wp-content/uploads/2023/11/hero.jpg");' },
    [{ image: "/wp-content/uploads/2020/03/logo.png?ver=2" }],
    "no assets here",
  ]);
  assert.deepEqual(refs.sort(), ["/wp-content/uploads/2020/03/logo.png", "/wp-content/uploads/2023/11/hero.jpg"]);
});

test("htmlToMarkdown applies wpautop's paragraph rules to classic-editor content", () => {
  const md = htmlToMarkdown("<span>First line.</span>\n\n<span>Second line.</span>\n<h2>Heading</h2>\nTrailing prose.");
  assert.equal(md, "First line.\n\nSecond line.\n\n## Heading\n\nTrailing prose.");
});

test("htmlToMarkdown converts links, emphasis and lists, and drops presentation", () => {
  const md = htmlToMarkdown(
    '<p style="font-weight:400">See <a href="/x/">our <strong>team</strong></a></p><ul><li>One</li><li>Two</li></ul>'
  );
  assert.equal(md, "See [our **team**](/x/)\n\n- One\n- Two");
});

test("htmlToMarkdown neutralizes characters MDX would compile", () => {
  assert.equal(htmlToMarkdown("<p>Costs {50} &lt; before</p>"), "Costs \\{50\\} \\< before");
});

test("htmlToMarkdown rewrites urls through the supplied mapper", () => {
  const md = htmlToMarkdown('<p><img src="/wp-content/x.jpg" alt="x"></p>', {
    rewriteUrl: (url, kind) => `${kind}:${url}`,
  });
  assert.equal(md, "![x](image:/wp-content/x.jpg)");
});

test("parseWxr reads items, meta and categories out of a WXR channel", () => {
  const xml = `<rss><channel><title>Site</title>
    <wp:base_site_url><![CDATA[https://example.com]]></wp:base_site_url>
    <item><title><![CDATA[Post & Co]]></title><link>https://example.com/p/</link>
      <wp:post_name><![CDATA[p]]></wp:post_name><wp:post_type><![CDATA[post]]></wp:post_type>
      <wp:status><![CDATA[publish]]></wp:status>
      <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <category domain="post_tag" nicename="seo"><![CDATA[SEO]]></category>
      <wp:postmeta><wp:meta_key><![CDATA[_thumbnail_id]]></wp:meta_key><wp:meta_value><![CDATA[42]]></wp:meta_value></wp:postmeta>
    </item></channel></rss>`;
  const channel = parseWxr(xml);
  assert.equal(channel.baseUrl, "https://example.com");
  assert.equal(channel.items.length, 1);
  const [post] = channel.items;
  assert.equal(post.title, "Post & Co");
  assert.equal(post.type, "post");
  assert.equal(post.meta._thumbnail_id, "42");
  assert.deepEqual(
    post.categories.filter((c) => c.domain === "category").map((c) => c.label),
    ["News"]
  );
});

// The dental service pages are the case this exists for: three sections that
// never hash alike as wholes, each carrying its own copy of the same card grid.
const cardGrid = (prefix, itemVar, boxes) => `
            <div class="${prefix}-grid">
              {list.map((${itemVar}) => (
                <div class="${prefix}-${boxes[0]}">
                  <div class="${prefix}-${boxes[1]}">
                    <div class="${prefix}-${boxes[2]}">
                      {${itemVar}.image && <img class="${prefix}-media" src={${itemVar}.image} alt={${itemVar}.imageAlt || ""} loading="lazy" width="150" height="150" />}
                    </div>
                    <div class="${prefix}-${boxes[3]}">
                      <div class="${prefix}-text2">{${itemVar}.text}</div>
                    </div>
                    <div class="${prefix}-${boxes[4]}">
                      <p class="${prefix}-text3">{${itemVar}.text2}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>`;

const generalDentistry = `---
const list = images;
---
<div class="general-dentistry-b">${cardGrid("gdb", "it", ["box11", "box12", "box13", "box14", "box15"])}
  <p class="gdb-text20">{text2}</p>
</div>
<style>
  .gdb-box12 {
    background-color: #f5f5f5;
  }

  .gdb-box12 .gdb-text2 {
    margin-top: -8px;
  }

  .gdb-box5 .gdb-box12 {
    margin: 0;
  }

  .gdb-text20 {
    font-size: 16px;
  }
</style>`;

const restorativeDentistry = `---
const list = images;
---
<div class="restorative-dentistry-b">${cardGrid("rdb", "c", ["box12", "box13", "box14", "box15", "box16"])}
  <p class="rdb-text10">{text2}</p>
</div>
<style>
  .rdb-box13 {
    background-color: #f5f5f5;
  }
</style>`;

test("repeatBlocks finds the emitted list.map blocks and their bounds", () => {
  const blocks = repeatBlocks(generalDentistry);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].listName, "list");
  assert.equal(blocks[0].itemVar, "it");
  assert.match(blocks[0].source, /gdb-media/);
});

test("partialKey ignores the class prefix and item variable the migrator varies", () => {
  const [general] = repeatBlocks(generalDentistry);
  const [restorative] = repeatBlocks(restorativeDentistry);
  assert.equal(partialKey(general.source, general.itemVar), partialKey(restorative.source, restorative.itemVar));
});

test("findSharedPartials groups the same widget across components", () => {
  const groups = findSharedPartials([
    { name: "general-dentistry-b", source: generalDentistry },
    { name: "restorative-dentistry-b", source: restorativeDentistry },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].members.map((m) => m.component).sort(),
    ["general-dentistry-b", "restorative-dentistry-b"]
  );
});

test("findSharedPartials ignores a shape only one component uses", () => {
  assert.deepEqual(findSharedPartials([{ name: "general-dentistry-b", source: generalDentistry }]), []);
});

test("ownedClasses keeps classes the section styles only through the block", () => {
  const [block] = repeatBlocks(generalDentistry);
  const owned = ownedClasses(generalDentistry, blockClasses(block.source));
  // `.gdb-box12 .gdb-text2` stays inside the block, so both are still owned.
  assert.ok(owned.includes("gdb-text2"));
  // `.gdb-box5 .gdb-box12` reaches in from the section, so box12 is not.
  assert.ok(!owned.includes("gdb-box12"));
});

test("partialKey ignores the list name, which is numbered by discovery order", () => {
  const a = `        {items3List.map((it) => (
          <li class="pg-box7">
            {it.buttonText && <a class="pg-link" href={it.buttonLink || "#"}>{it.buttonText}</a>}
          </li>
        ))}`;
  const b = `        {items7List.map((c) => (
          <li class="se-box38">
            {c.buttonText && <a class="se-link" href={c.buttonLink || "#"}>{c.buttonText}</a>}
          </li>
        ))}`;
  assert.equal(partialKey(a, "it"), partialKey(b, "c"));
});

test("textKey folds the whitespace and nbsp the two DOMs disagree about", () => {
  assert.equal(textKey("  Schedule an   Appointment\n"), "schedule an appointment");
});

test("diffTextNodes pairs on text, not on document order", () => {
  // The built page wraps its heading one level deeper than the source, which is
  // exactly what breaks positional pairing.
  const source = [
    ["complete dental restorations", { tag: "H3", style: { fontSize: "28px", fontFamily: "Montserrat" }, classes: [] }],
    ["if you want to explore", { tag: "P", style: { fontSize: "16px", fontFamily: "Roboto" }, classes: [] }],
  ];
  const built = [
    ["if you want to explore", { tag: "P", style: { fontSize: "32px", fontFamily: "Montserrat" }, classes: ["rdb-text11"] }],
    ["complete dental restorations", { tag: "H3", style: { fontSize: "16px", fontFamily: "Roboto" }, classes: ["rdb-heading4"] }],
  ];
  const findings = diffTextNodes(source, built);
  assert.equal(findings.length, 2);
  const heading = findings.find((f) => f.key.startsWith("complete"));
  assert.deepEqual(
    heading.diffs.map((d) => [d.prop, d.source, d.built]).sort(),
    [["fontFamily", "Montserrat", "Roboto"], ["fontSize", "28px", "16px"]]
  );
});

test("diffTextNodes reports nothing for text the source does not have", () => {
  const built = [["built only", { tag: "P", style: { fontSize: "16px" }, classes: [] }]];
  assert.deepEqual(diffTextNodes([], built), []);
});

test("severeFindings keeps a flattened heading and drops a 1px nudge", () => {
  const flattened = { key: "h", diffs: [{ prop: "fontSize", source: "32px", built: "16px" }] };
  const nudge = { key: "n", diffs: [{ prop: "fontSize", source: "15px", built: "14px" }] };
  assert.deepEqual(severeFindings([flattened, nudge]), [flattened]);
});

test("nameFromShape recognises a hero whether or not it carries a button", () => {
  const hero = (extra = []) => ({
    kind: "box",
    children: [{ kind: "heading", text: "Contact Toothbar" }, ...extra],
  });
  const opts = { hasBackgroundImage: true };

  // 21 of the toothbar heroes had a "BECOME A PATIENT" button; gating on
  // button === 0 sent every one of them to nameFromContent, which named them
  // after their page heading and forked the family.
  assert.equal(nameFromShape(hero(), opts), "page-hero");
  assert.equal(nameFromShape(hero([{ kind: "button", text: "BECOME A PATIENT" }]), opts), "page-hero");
});

test("nameFromShape does not call a section a hero without a background image", () => {
  const tree = { kind: "box", children: [{ kind: "heading", text: "Our Office" }] };
  assert.notEqual(nameFromShape(tree, { hasBackgroundImage: false }), "page-hero");
});

test("initialsOf gives two components with the same initials different prefixes", () => {
  const taken = new Set();
  const claim = (name) => {
    const prefix = initialsOf(name, taken);

    taken.add(prefix);
    return prefix;
  };

  // Four-letter truncation makes each of these pairs identical; both members
  // still have to end up with a prefix of their own.
  assert.equal(claim("media-prose-what"), "mpw");
  assert.notEqual(claim("media-prose-who"), "mpw");
  assert.equal(claim("card-grid-home-chao"), "cghc");
  assert.notEqual(claim("card-grid-home-cosmetic"), "cghc");
  assert.equal(taken.size, 4);
});

test("initialsOf is unchanged when nothing has claimed the prefix", () => {
  assert.equal(initialsOf("tour-cards"), "tc");
  assert.equal(initialsOf("tour-cards", new Set()), "tc");
  assert.equal(initialsOf("banner"), "ba");
});
