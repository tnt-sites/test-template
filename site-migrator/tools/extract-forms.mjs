#!/usr/bin/env node
/**
 * Rebuild the source's forms with the starter's form-builder components.
 *
 * site-migrator has no form path at all: mapToComponent handles heading,
 * eyebrow, image, buttons, items and prose, and `features.hasForm` is only a
 * clustering signal. So a source form arrives as flattened prose in `subtext`
 * — every field label run together as markdown text, with the component's
 * `formBlocks` left at its default.
 *
 * This runs after `mig content`. It reads the real <form> elements out of the
 * instrumented mirror, converts each control into the matching
 * building-blocks/forms/* structure value, and patches the emitted page's
 * front matter.
 *
 * The source's forms are hand-written HTML inside `elementor-widget-html`
 * widgets (not Elementor Pro Forms), posting to admin-post.php. The backend is
 * deliberately NOT wired up here — `formAction` is set to the source's own
 * thank-you page so the form is visibly inert but not destructive, and
 * swapping in a real endpoint later is a one-line change per page.
 *
 * Usage:
 *   node tools/extract-forms.mjs --dry-run
 *   node tools/extract-forms.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { chromium } from "playwright";
import { serve } from "../src/mirror/serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIRROR = path.join(ROOT, ".migration/instrumented");
const PAGES = path.resolve(ROOT, "../src/content/pages");

const FORM_ACTION = "/thank-you/";
const FORM_COMPONENTS = /^page-sections\/(ctas\/cta-form|forms\/|artisan\/contact-block)/;

// WordPress plugin plumbing — routing and CSRF fields with no meaning in a
// static build. `_subject` is kept: it names the form for whatever backend
// gets wired up later.
const DROP_HIDDEN = /^(action|token_generate|page_url|_redirect|_wpnonce|_wp_http_referer)$/i;

const dryRun = process.argv.includes("--dry-run");

const titleCase = (s) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** Pull every form on the page, with each control's resolved label. */
const EXTRACT = () => {
  const labelFor = (el) => {
    const wrap = el.closest("label");
    if (wrap) {
      const t = wrap.textContent.replace(/\s+/g, " ").trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) {
        const t = l.textContent.replace(/\s+/g, " ").trim();
        if (t) return t;
      }
    }
    return el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
  };

  return [...document.querySelectorAll("form")].map((form) => {
    const controls = [];
    for (const el of form.querySelectorAll("input, select, textarea, button")) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || (tag === "button" ? "submit" : "text")).toLowerCase();
      controls.push({
        tag,
        type,
        name: el.getAttribute("name") || "",
        label: labelFor(el),
        placeholder: el.getAttribute("placeholder") || "",
        required: el.hasAttribute("required"),
        value: el.getAttribute("value") || "",
        text: tag === "button" ? el.textContent.replace(/\s+/g, " ").trim() : "",
        options:
          tag === "select"
            ? [...el.options].map((o) => ({ value: o.value, label: o.textContent.trim() }))
            : null,
      });
    }
    return {
      action: form.getAttribute("action") || "",
      hasRecaptcha: /recaptcha/i.test(form.className) || !!form.querySelector("[data-sitekey],.g-recaptcha"),
      controls,
    };
  });
};

/** Source controls -> starter formBlocks. */
function toFormBlocks(form) {
  const blocks = [];
  const radioGroups = new Map();

  for (const c of form.controls) {
    const label = (c.label || c.placeholder || titleCase(c.name)).replace(/\s*\*$/, "").trim();

    if (c.tag === "input" && (c.type === "radio" || c.type === "checkbox")) {
      // One choice-group per name, not one per option.
      if (!radioGroups.has(c.name)) {
        const group = {
          _component: "building-blocks/forms/choice-group",
          id: "",
          title: titleCase(c.name),
          name: c.name,
          required: c.required,
          options: [],
          orientation: "horizontal",
          multiple: c.type === "checkbox",
        };
        radioGroups.set(c.name, group);
        blocks.push(group);
      }
      radioGroups.get(c.name).options.push({
        value: c.value || label,
        label: label || c.value,
        checked: false,
      });
      continue;
    }

    if (c.tag === "textarea") {
      blocks.push({
        _component: "building-blocks/forms/textarea",
        id: "", label, name: c.name, required: c.required,
        placeholder: c.placeholder || null, value: null,
      });
      continue;
    }

    if (c.tag === "select") {
      blocks.push({
        _component: "building-blocks/forms/select",
        id: "", label, name: c.name, required: c.required,
        options: (c.options || []).filter((o) => o.value !== ""),
        placeholder: (c.options || []).find((o) => o.value === "")?.label ?? null,
      });
      continue;
    }

    if (c.tag === "button" || c.type === "submit") {
      blocks.push({
        _component: "building-blocks/forms/submit",
        id: "", text: c.text || c.value || "Submit",
        variant: "primary", size: "md",
        iconName: null, iconPosition: "before", hideText: false, disabled: false,
      });
      continue;
    }

    if (c.type === "hidden") {
      if (DROP_HIDDEN.test(c.name)) continue;
      blocks.push({
        _component: "building-blocks/forms/hidden",
        id: "", name: c.name, value: c.value,
      });
      continue;
    }

    if (c.type === "date") {
      blocks.push({
        _component: "building-blocks/forms/date",
        id: "", label, name: c.name, required: c.required,
        // The structure value seeds a literal date; an empty field is correct.
        value: null, min: null, max: null,
      });
      continue;
    }

    if (c.type === "file") {
      blocks.push({
        _component: "building-blocks/forms/file-upload",
        id: "", label, name: c.name, required: c.required,
      });
      continue;
    }

    blocks.push({
      _component: "building-blocks/forms/input",
      id: "", label, name: c.name,
      type: ["text", "email", "tel", "number", "url", "password"].includes(c.type) ? c.type : "text",
      placeholder: c.placeholder || null,
      required: c.required,
      value: null,
    });
  }

  if (form.hasRecaptcha) {
    // siteKey null falls back to siteInfo.recaptchaSiteKey.
    blocks.splice(blocks.findIndex((b) => b._component.endsWith("/submit")) ?? blocks.length, 0, {
      _component: "building-blocks/forms/recaptcha",
      id: "", siteKey: null,
    });
  }

  return blocks;
}

/** A stable signature so the desktop/mobile duplicate collapses to one. */
const signatureOf = (form) =>
  form.controls.map((c) => `${c.tag}:${c.type}:${c.name}`).join("|");

async function main() {
  if (!fs.existsSync(MIRROR)) throw new Error("No mirror. Run `mig mirror` first.");

  const { server, url } = await serve(MIRROR, 0);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const pageIds = fs
    .readdirSync(MIRROR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""));

  const report = [];

  for (const id of pageIds) {
    await page.goto(`${url}/${id}.html`, { waitUntil: "load" });
    const forms = await page.evaluate(EXTRACT);
    if (!forms.length) continue;

    // Collapse the desktop/mobile duplicates.
    const unique = [];
    const seen = new Set();
    for (const f of forms) {
      const sig = signatureOf(f);
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);
      unique.push(f);
    }
    if (!unique.length) continue;

    const mdPath = path.join(PAGES, `${id}.md`);
    if (!fs.existsSync(mdPath)) {
      report.push({ id, status: "no page file", forms: unique.length });
      continue;
    }

    const raw = fs.readFileSync(mdPath, "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) {
      report.push({ id, status: "no front matter", forms: unique.length });
      continue;
    }

    const data = YAML.parse(m[1]);
    const sections = data.pageSections ?? [];
    const targets = sections.filter((s) => FORM_COMPONENTS.test(s._component ?? ""));

    if (!targets.length) {
      report.push({ id, status: "no form component on page", forms: unique.length });
      continue;
    }

    let patched = 0;
    targets.forEach((section, i) => {
      const form = unique[Math.min(i, unique.length - 1)];
      const blocks = toFormBlocks(form);
      if (!blocks.length) return;
      section.formBlocks = blocks;
      section.formAction = FORM_ACTION;
      // mig content flattened the whole form into prose; leaving it would
      // render every field label twice, once as text and once as a field.
      if (typeof section.subtext === "string" && /First Name|Email|Phone|Submit/i.test(section.subtext)) {
        section.subtext = "";
      }
      patched++;
    });

    if (patched && !dryRun) {
      fs.writeFileSync(mdPath, `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n${m[2]}`, "utf8");
    }
    report.push({
      id,
      status: patched ? "patched" : "no blocks",
      forms: unique.length,
      sections: targets.length,
      fields: toFormBlocks(unique[0]).length,
    });
  }

  await browser.close();
  server.close();

  console.log(`${dryRun ? "[dry run] " : ""}Forms:`);
  for (const r of report) {
    console.log(
      `  ${r.id.padEnd(24)} ${r.status.padEnd(26)} forms=${r.forms}${r.fields ? ` fields=${r.fields}` : ""}`
    );
  }
  console.log(`\nformAction set to ${FORM_ACTION} — backend intentionally unwired.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
