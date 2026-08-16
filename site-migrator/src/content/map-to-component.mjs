import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { htmlToMarkdown, htmlToInline, htmlToText } from "./html-to-md.mjs";
import { resolveItemIcons } from "./resolve-icon.mjs";

/**
 * Fit extracted content into a target component's actual prop shape.
 *
 * The component's own `structure-value.yml` supplies the defaults and, more
 * importantly, tells us which props it really has. Writing a `subtext` onto a
 * component with no such prop produces frontmatter that silently renders
 * nothing, so content that has nowhere to go is recorded rather than assigned.
 */

/** Field aliases, tried in order, for content the source produced. */
const FIELD_ALIASES = {
  heading: ["heading", "title", "eyebrowHeading"],
  subtext: ["subtext", "body", "description", "text", "content"],
  eyebrow: ["eyebrow", "eyebrowText", "kicker"],
  imageSource: ["imageSource", "image", "backgroundImage.source"],
  imageAlt: ["imageAlt", "alt", "backgroundImage.alt"],
  items: ["items", "cards", "links", "listItems", "emergencyItems"],
};

const STOPWORDS = new Set(["a", "an", "the", "to", "or", "and", "of", "for", "in", "my", "your"]);

/** Loose word set for comparing a source label with a select option id. */
function tokenize(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => word.replace(/(?<=.{3})s$/, ""))
      .filter((word) => !STOPWORDS.has(word))
  );
}

/**
 * Pick the select option a source label means.
 *
 * A component can constrain an item field to a fixed vocabulary — emergency-grid's
 * `iconPreset` is the case that prompted this. The source writes the same thing as
 * display copy ("Gums, Lips or Tongue Injury" for `gum-lip-tongue-injury`), so the
 * two never match on a slug comparison but overlap almost completely on words.
 *
 * Returns null rather than a near-miss: a wrong icon reads as a deliberate choice,
 * while an empty field is visibly unfinished.
 */
export function bestOptionId(label, ids) {
  const wanted = tokenize(label);
  if (!wanted.size) return null;

  let best = null;
  let bestScore = 0;

  for (const id of ids) {
    const candidate = tokenize(id);
    const shared = [...candidate].filter((word) => wanted.has(word)).length;
    const score = shared / Math.max(candidate.size, 1);
    if (shared && score > bestScore) {
      best = id;
      bestScore = score;
    }
  }

  return bestScore >= 0.6 ? best : null;
}

/** Select-constrained fields on a component's array item, as `{ field: [ids] }`. */
function itemSelectOptions(defaults, target) {
  const inputs = defaults.structures?.[target]?.values?.[0]?._inputs ?? {};
  const out = {};

  for (const [field, input] of Object.entries(inputs)) {
    if (input?.type !== "select") continue;
    const ids = (input.options?.values ?? []).map((v) => v?.id ?? v).filter(Boolean);
    if (ids.length) out[field] = ids;
  }

  return out;
}

/**
 * Render extracted items back into a Markdown list.
 *
 * The escape hatch for a list whose component has no array prop to put it in.
 * `extract` claims a repeated run of siblings as `items` and removes it from
 * the body HTML, so without this the list is gone from the page entirely — not
 * merely un-styled.
 *
 * Prefers the item's own inner HTML, because `text` has already been flattened
 * to a plain string: a source list item that opens `<strong>Consultation</strong>
 * &ndash; …` loses its lead-in emphasis otherwise. Links are left as they come
 * out of the conversion; `mig links` rewrites legacy URLs across the written
 * content afterwards, so these get the same treatment as body prose.
 */
export function itemsToMarkdown(items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const lines = items
    .map((item) => {
      const inline = item.html ? htmlToInline(item.html) : "";
      const fallback = [item.heading, item.text].filter(Boolean).join(" — ");
      const content = (inline || fallback || "").trim();
      return content ? `- ${content}` : "";
    })
    .filter(Boolean);

  return lines.join("\n");
}

const structureCache = new Map();

/** Load a component's default value block, given its `_component` key. */
export function loadComponentDefaults(componentKey, componentsDir) {
  if (structureCache.has(componentKey)) return structureCache.get(componentKey);

  const kebab = componentKey.split("/").pop();
  const file = path.join(componentsDir, componentKey, `${kebab}.cloudcannon.structure-value.yml`);

  let result = null;
  if (fs.existsSync(file)) {
    const doc = YAML.parse(fs.readFileSync(file, "utf8"));
    if (doc?.value) {
      result = { value: doc.value, label: doc.label, structures: doc._structures ?? null, file };
    }
  }

  structureCache.set(componentKey, result);
  return result;
}

function hasProp(value, name) {
  if (name.includes(".")) {
    const [head, tail] = name.split(".");
    return value?.[head] && typeof value[head] === "object" && tail in value[head];
  }
  return value && name in value;
}

function setProp(value, name, next) {
  if (name.includes(".")) {
    const [head, tail] = name.split(".");
    value[head] = { ...(value[head] ?? {}), [tail]: next };
    return;
  }
  value[name] = next;
}

/** First alias the component actually declares. */
function targetFor(value, logical) {
  for (const candidate of FIELD_ALIASES[logical] ?? [logical]) {
    if (hasProp(value, candidate)) return candidate;
  }
  return null;
}

/**
 * @param {object} extracted  output of `extractSection`
 * @param {string} componentKey
 * @param {object} opts { componentsDir, assetMap, urlMap, behavior }
 */
export function mapToComponent(extracted, componentKey, opts = {}) {
  const {
    componentsDir,
    assetMap = new Map(),
    urlMap = new Map(),
    glyphMap = null,
    iconSet = null,
    fontelloSet = null,
  } = opts;

  const defaults = loadComponentDefaults(componentKey, componentsDir);
  if (!defaults) {
    return {
      error: `No structure-value found for "${componentKey}". Check component-map.yml.`,
    };
  }

  const value = structuredClone(defaults.value);
  value._component = componentKey;
  const unmapped = [];
  const filled = new Set();
  const approximatedIcons = [];

  const assign = (logical, content, { markdown = false } = {}) => {
    if (content === undefined || content === null || content === "") return;
    const target = targetFor(value, logical);
    if (!target) {
      unmapped.push({ field: logical, content: typeof content === "string" ? content : "" });
      return;
    }
    setProp(value, target, content);
    filled.add(target);
    return target;
  };

  const p = extracted.props;

  assign("heading", p.heading ? htmlToInline(p.heading) : undefined);
  assign("eyebrow", p.eyebrow ? htmlToText(p.eyebrow) : undefined);

  // Body copy goes to whichever prose field the component offers. Assigned
  // below rather than here, because a list the component cannot hold as an
  // array prop gets folded back into it first.
  let body = extracted.bodyHtml ? htmlToMarkdown(extracted.bodyHtml) : "";

  if (p.imageSource) {
    assign("imageSource", rewriteAsset(p.imageSource, assetMap));
    assign("imageAlt", p.imageAlt ?? "");
  }

  if (p.buttonSections?.length) {
    const target = targetFor(value, "buttonSections") ?? (hasProp(value, "buttonSections") ? "buttonSections" : null);
    if (target) {
      // Reuse the seeded button shape so nested `_component` keys stay correct.
      const template = Array.isArray(defaults.value.buttonSections)
        ? defaults.value.buttonSections[0]
        : null;
      value.buttonSections = p.buttonSections.map((b) => ({
        ...(template ?? {}),
        text: b.text,
        link: rewriteLink(b.link, urlMap),
      }));
    } else {
      unmapped.push({ field: "buttonSections", content: JSON.stringify(p.buttonSections) });
    }
  }

  if (p.items?.length) {
    const target = targetFor(value, "items");
    if (target) {
      // Translate the source's own icon vocabulary before building the items,
      // so a list keeps its real icon instead of the component's seeded default.
      const icons = resolveItemIcons(p.items, { glyphMap, iconSet, fontelloSet });
      if (icons.unresolved.length) {
        unmapped.push({ field: "iconName", content: icons.unresolved.join(", ") });
      }
      if (icons.approximated.length) approximatedIcons.push(...icons.approximated);

      const template = Array.isArray(defaults.value[target]) ? defaults.value[target][0] : null;
      const labels = p.items.map((item) => item.heading || item.text || "");

      // A select whose options are a vocabulary of the source's own labels —
      // emergency-grid's `iconPreset` — should be filled from those labels.
      // A select of presentation values (`iconColor`, `size`) matches nothing
      // and must be left at the component's default, so require most of the
      // run to match before treating the field as content-derived at all.
      const selects = Object.entries(itemSelectOptions(defaults, target)).filter(
        ([, ids]) => labels.filter((label) => bestOptionId(label, ids)).length > labels.length / 2
      );

      value[target] = p.items.map((item, index) => {
        const base = { ...(template ?? {}) };

        // A seeded item carries demo content of its own — emergency-grid's items
        // each ship a lorem-ipsum modal. Nothing else clears it, and it ships.
        for (const [key, seeded] of Object.entries(base)) {
          if (Array.isArray(seeded)) base[key] = [];
        }

        const label = labels[index];
        const candidate = {
          ...(item.heading ? { heading: item.heading } : {}),
          ...(item.text ? { text: item.text } : {}),
          ...(label ? { title: label } : {}),
          ...(item.iconName ? { iconName: item.iconName } : {}),
          ...(item.iconImage
            ? { iconImage: rewriteAsset(item.iconImage, assetMap), iconAlt: item.iconAlt }
            : {}),
          ...(item.imageSource
            ? { imageSource: rewriteAsset(item.imageSource, assetMap), imageAlt: item.imageAlt }
            : {}),
          ...(item.link ? { link: rewriteLink(item.link, urlMap) } : {}),
        };

        // Only fields the item shape declares. Writing `heading`/`text` onto an
        // item that has neither leaves keys the component never reads.
        for (const [key, next] of Object.entries(candidate)) {
          if (!template || key in base) base[key] = next;
        }

        for (const [field, ids] of selects) {
          if (!(field in base)) continue;
          const match = bestOptionId(label, ids);
          base[field] = match ?? "";
          if (!match) unmapped.push({ field: `${target}.${field}`, content: label });
        }

        return base;
      });
    } else {
      // No array prop to hold it. Shelving the list to `_migUnmapped` here was
      // silently deleting every `<ul>` on the interior pages: `extract` claims
      // a repeated run as `items` and *removes it from `bodyHtml`*, so a
      // component without the prop dropped it from the prose as well and the
      // page rendered with the list simply gone.
      //
      // A prose list is prose. Write it back into the body as Markdown, which
      // the template renders as a real `<ul>` and styles like any other list.
      // Only fall back to `_migUnmapped` when there is no prose field either —
      // then the content genuinely has nowhere to go.
      const listMarkdown = itemsToMarkdown(p.items);

      if (listMarkdown && targetFor(value, "subtext")) {
        body = body ? `${body}\n\n${listMarkdown}` : listMarkdown;
      } else {
        unmapped.push({ field: "items", content: JSON.stringify(p.items) });
      }
    }
  }

  if (body) assign("subtext", body, { markdown: true });

  // Embeds are props when the component has one, and preserved otherwise.
  for (const embed of extracted.embeds ?? []) {
    if (hasProp(value, embed.prop)) setProp(value, embed.prop, embed.value);
    else unmapped.push({ field: embed.prop, content: embed.value });
  }

  // Section background, only where the component exposes it.
  if (extracted.background?.hex && hasProp(value, "backgroundColorHex")) {
    value.backgroundColorHex = extracted.background.hex;
    if (hasProp(value, "backgroundColor")) value.backgroundColor = "none";
  }

  if (extracted.sourceId && hasProp(value, "id")) value.id = extracted.sourceId;

  clearUnfilledPlaceholders(value, defaults.value, filled);

  return { value, unmapped, approximatedIcons, componentKey, label: defaults.label };
}

/**
 * Blank the demo content a structure-value ships with wherever real content
 * did not replace it.
 *
 * Those defaults exist to make a component look right when an editor inserts it
 * by hand. Carried through a migration they become stock photography and
 * "Subtext placeholder text" on every page — far worse than an empty field,
 * because an empty field is obviously unfinished while a plausible placeholder
 * silently ships.
 */
export function clearUnfilledPlaceholders(value, defaults, filled) {
  const PLACEHOLDER_TEXT = /placeholder|lorem ipsum|replaced with actual content|^my button$|^heading text$|^eyebrow text$/i;
  const PLACEHOLDER_ASSET = /\/component-library\//i;

  for (const [key, original] of Object.entries(defaults)) {
    if (key === "_component" || filled.has(key)) continue;

    if (typeof original === "string") {
      if (PLACEHOLDER_TEXT.test(original) || PLACEHOLDER_ASSET.test(original)) value[key] = "";
      continue;
    }

    if (Array.isArray(original)) {
      // A seeded array is a shape example, not content. Only keep it if real
      // items were written into it.
      if (!filled.has(key) && arraysMatch(value[key], original)) value[key] = [];
      continue;
    }

    if (original && typeof original === "object") {
      for (const [subKey, subValue] of Object.entries(original)) {
        if (typeof subValue !== "string") continue;
        if (filled.has(`${key}.${subKey}`)) continue;
        if (PLACEHOLDER_TEXT.test(subValue) || PLACEHOLDER_ASSET.test(subValue)) {
          value[key][subKey] = "";
        }
      }
    }
  }
}

function arraysMatch(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function rewriteAsset(src, assetMap) {
  if (!src) return src;
  const clean = src.split("?")[0];
  return assetMap.get(clean) ?? assetMap.get(clean.replace(/^\//, "")) ?? src;
}

function rewriteLink(href, urlMap) {
  if (!href) return href;
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;
  const clean = href.split("#")[0];
  const hash = href.slice(clean.length);
  const mapped = urlMap.get(clean) ?? urlMap.get(`/${clean.replace(/^\//, "")}`);
  return mapped ? mapped + hash : href;
}

/**
 * Choose a component for a cluster, honouring conditional variants.
 *
 * A single source pattern often needs different targets depending on its
 * content — an interior hero with an image is a split layout, the same hero
 * without one is centred. Expressing that as a condition on a measured feature
 * keeps it declarative instead of a manual per-page decision.
 */
export function resolveComponent(entry, section) {
  if (!entry) return null;
  if (typeof entry === "string") return { component: entry };
  if (entry.component && !entry.variants) return entry;

  for (const variant of entry.variants ?? []) {
    if (!variant.when) return variant; // no condition = default, listed last
    const matches = Object.entries(variant.when).every(([feature, expected]) => {
      const actual = section.features?.[feature];
      const allowed = Array.isArray(expected) ? expected : [expected];
      return allowed.some((v) => String(v) === String(actual));
    });
    if (matches) return variant;
  }

  return null;
}
