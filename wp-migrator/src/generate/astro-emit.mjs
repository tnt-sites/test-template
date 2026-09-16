/**
 * Template tree + props → the .astro component file, in the house style of the
 * hand-written artisan components: doc comment stating baked-in vs. editable,
 * destructured Astro.props with defaults, the `id, _component, ...rest`
 * swallow, colors threaded as CSS custom properties on the root's style attr,
 * scoped <style> at the end.
 */

import { titleCase } from "./names.mjs";

const ROOT_TAGS = new Set(["section", "div", "article", "aside", "header", "footer"]);

const escapeAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escapeTemplate = (v) => String(v).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

function attrText(attrs, skip = []) {
  const parts = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (skip.includes(k) || k === "srcset") continue;
    parts.push(v === "" ? k : `${k}="${escapeAttr(v)}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function emitAstro({ name, tree, props, values, colorSlots, backgroundImageProp, css, source }) {
  const label = titleCase(name);
  const arrays = props.filter((p) => p.kind === "array");
  const rawConsts = [];
  let usesButton = false;
  let usesIcon = false;

  // ---- destructured props ----------------------------------------------
  const destructured = props.map((p) => {
    if (p.kind === "array") return `${p.name} = []`;
    if (p.kind === "color" || p.kind === "colorHex") return `${p.name} = ${JSON.stringify(values[p.name] ?? "")}`;
    if (p.name === backgroundImageProp?.name) return `${p.name} = ${JSON.stringify(values[p.name] ?? "")}`;
    return `${p.name} = ""`;
  });
  destructured.push("id", "_component", "...rest");

  const listDecls = arrays.map((a) => {
    const listName = arrays.length === 1 ? "list" : `${a.name}List`;
    a.listName = listName;
    return `const ${listName} = Array.isArray(${a.name}) ? ${a.name}.filter(Boolean) : [];`;
  });

  // ---- style attr -------------------------------------------------------
  // Each colour is a palette selection with an optional hex override and the
  // shade measured off the source site as the last resort, so an untouched
  // component still looks like what was migrated.
  const colorConsts = colorSlots.map((s) => {
    const fallbacks = [s.hexName, s.name].filter(Boolean);
    const baked = JSON.stringify(s.value ?? "");
    return `const ${s.name}Value = ${fallbacks.join(" || ")} || ${baked};`;
  });
  const varParts = colorSlots.map((s) => `${s.varName}:\${${s.name}Value}`);
  let styleAttr = "";
  if (varParts.length || backgroundImageProp) {
    const bgTail = backgroundImageProp
      ? `\${${backgroundImageProp.name} ? \`;${backgroundImageProp.varName}:url('\${${backgroundImageProp.name}}')\` : ""}`
      : "";
    styleAttr = ` style={\`${varParts.join(";")}${bgTail}\`}`;
  }

  // ---- markup -----------------------------------------------------------
  const lines = [];
  const emit = (line) => lines.push(line);

  const propRef = (node, itemVar) => {
    if (itemVar && node.itemProp) return { ...node.itemProp, ref: (n) => `${itemVar}.${n}` };
    if (!itemVar && node.prop) return { ...node.prop, ref: (n) => n };
    return null;
  };

  const render = (node, indent, itemVar) => {
    if (node.skip) return;
    const pad = "  ".repeat(indent);
    const cls = node.cls ? ` class="${node.cls}"` : "";
    const p = propRef(node, itemVar);

    switch (node.kind) {
      case "heading":
      case "text": {
        if (!p) {
          emit(`${pad}<${node.tag}${cls}>${node.text ?? ""}</${node.tag}>`);
          return;
        }
        const expr = p.ref(p.name);
        const inner = p.kind === "html" ? ` set:html={${expr}}` : "";
        const body = p.kind === "html" ? "" : `{${expr}}`;
        const open = `<${node.tag}${cls}${inner}>`;
        const line = p.kind === "html" ? `${pad}<${node.tag}${cls} set:html={${expr}} />` : `${pad}${open}${body}</${node.tag}>`;
        const optional = itemVar ? node.itemProp?.optional : node.prop?.name !== "heading";
        emit(optional ? `${pad}{${expr} && ${line.trim()}}` : line);
        return;
      }
      case "richtext": {
        if (!p) return;
        const expr = p.ref(p.name);
        emit(`${pad}{${expr} && <div${cls} set:html={${expr}} />}`);
        return;
      }
      case "img": {
        const src = p ? p.ref(p.name) : null;
        const altName = itemVar ? node.itemProp?.altName : node.prop?.altName;
        const alt = altName ? (itemVar ? `${itemVar}.${altName}` : altName) : null;
        const extra = attrText(node.attrs, ["src", "alt", "loading"]);
        if (src) {
          emit(`${pad}{${src} && <img${cls} src={${src}} alt={${alt ?? '""'} || ""} loading="lazy"${extra} />}`);
        } else {
          emit(`${pad}<img${cls} src="${escapeAttr(node.attrs.src || "")}" alt="${escapeAttr(node.attrs.alt || "")}" loading="lazy"${extra} />`);
        }
        return;
      }
      case "button": {
        // Real buttons go through the repo's shared Button component so they
        // inherit its markup, accessibility handling and CMS wiring. Exact
        // source colours/metrics arrive via the passthrough class, which the
        // stylesheet targets with :global() (Button renders outside this
        // component's scope, so a scoped selector would never match it).
        usesButton = true;
        const meta = node.buttonMeta ?? {};
        const attrs = [
          `variant="${meta.variant ?? "primary"}"`,
          `size="${meta.size ?? "md"}"`,
          `width="${meta.width ?? "none"}"`,
          `borderRadius="${meta.borderRadius ?? "default"}"`,
          `borderWidth="${meta.borderWidth ?? "none"}"`,
          meta.uppercase ? `uppercase` : null,
          node.cls ? `class="${node.cls}"` : null,
        ].filter(Boolean).join(" ");

        if (!p) {
          emit(`${pad}<Button ${attrs} text="${escapeAttr(node.text ?? "")}" link="${escapeAttr(node.attrs.href || "#")}" />`);
          return;
        }
        const textExpr = p.ref(p.name);
        const linkExpr = p.linkName ? p.ref(p.linkName) : '"#"';
        emit(`${pad}{${textExpr} && <Button ${attrs} text={${textExpr}} link={${linkExpr} || "#"} />}`);
        return;
      }
      case "textlink": {
        // An inline text link is prose, not a control — it stays an anchor.
        if (!p) {
          emit(`${pad}<a${cls} href="${escapeAttr(node.attrs.href || "#")}">${node.text ?? ""}</a>`);
          return;
        }
        const textExpr = p.ref(p.name);
        const linkExpr = p.linkName ? p.ref(p.linkName) : '"#"';
        emit(`${pad}{${textExpr} && <a${cls} href={${linkExpr} || "#"}>{${textExpr}}</a>}`);
        return;
      }
      case "embed": {
        // A recovered video becomes a real embed. The source's own iframe never
        // existed in the captured DOM (its script builds it at runtime), so the
        // canonical embed URL is reconstructed from the captured id.
        if (node.video) {
          const embedSrc = node.video.provider === "vimeo"
            ? `https://player.vimeo.com/video/${node.video.id}`
            : `https://www.youtube.com/embed/${node.video.id}`;
          emit(
            `${pad}<iframe${cls} src="${escapeAttr(embedSrc)}" title="${escapeAttr(node.video.provider === "vimeo" ? "Vimeo video" : "YouTube video")}" ` +
              `loading="lazy" frameborder="0" allowfullscreen ` +
              `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`
          );
          return;
        }
        const src = p?.kind === "url" ? p.ref(p.name) : null;
        const extra = attrText(node.attrs, ["src"]);
        if (node.tag === "iframe") {
          emit(src ? `${pad}<iframe${cls} src={${src}}${extra} loading="lazy"></iframe>` : `${pad}<iframe${cls}${attrText(node.attrs)} loading="lazy"></iframe>`);
        } else {
          emit(`${pad}<${node.tag}${cls}${attrText(node.attrs)}></${node.tag}>`);
        }
        return;
      }
      case "raw": {
        const constName = `raw${rawConsts.length}`;
        rawConsts.push(`const ${constName} = \`${escapeTemplate(node.html || "")}\`;`);
        emit(`${pad}<div${cls}><Fragment set:html={${constName}} /></div>`);
        return;
      }
      case "divider": {
        // An <hr> rule from the source. Its measured colour/thickness/margins
        // travel on the passthrough class like any other node.
        emit(`${pad}<hr${cls} />`);
        return;
      }
      case "spacer":
      case "decor": {
        // A glyph whose icon font could not travel is substituted with the
        // project's own equivalent SVG. The wrapping span keeps the measured
        // box (font-size drives the glyph size, colour drives currentColor),
        // so the icon lands at the size and colour the source rendered.
        if (node.iconName) {
          usesIcon = true;
          emit(`${pad}<span${cls} aria-hidden="true"><Icon name="${escapeAttr(node.iconName)}" /></span>`);
          return;
        }
        emit(`${pad}<div${cls} aria-hidden="true"></div>`);
        return;
      }
      default: {
        // container
        if (node.array) {
          const { itemVar: v, template } = node.array;
          const listName = arrays.find((a) => a.name === node.array.name)?.listName ?? "list";
          emit(`${pad}<${node.tag}${cls}>`);
          emit(`${pad}  {${listName}.map((${v}) => (`);
          renderItem(template, indent + 2, v);
          emit(`${pad}  ))}`);
          emit(`${pad}</${node.tag}>`);
          return;
        }
        const isRoot = node === tree;
        const tag = isRoot && !ROOT_TAGS.has(node.tag) ? "section" : node.tag;
        let hrefAttr = "";
        if (!isRoot && tag === "a") {
          const linkName = itemVar ? node.itemLink : node.prop?.kind === "url" ? node.prop.name : null;
          if (linkName) {
            const expr = itemVar ? `${itemVar}.${linkName}` : linkName;
            hrefAttr = ` href={${expr} || "#"}`;
          } else if (node.attrs.href) {
            // No editable prop claimed this anchor — keep it working as a literal.
            hrefAttr = ` href="${escapeAttr(node.attrs.href)}"`;
          }
        }
        const open = isRoot
          ? `${pad}<${tag} class="${node.cls}" id={id || undefined}${styleAttr} {...rest}>`
          : `${pad}<${tag}${cls}${hrefAttr}${attrText(node.attrs, ["href"])}>`;
        emit(open);
        for (const c of node.children || []) render(c, indent + 1, itemVar);
        emit(`${pad}</${tag}>`);
      }
    }
  };

  const renderItem = (template, indent, itemVar) => {
    const pad = "  ".repeat(indent);
    const linkName = template.itemLink;
    const cls = template.cls ? ` class="${template.cls}"` : "";
    if (template.tag === "a" || linkName) {
      const tag = template.tag === "a" ? "a" : template.tag;
      const href = linkName ? ` href={${itemVar}.${linkName} || "#"}` : "";
      emit(`${pad}<${tag}${cls}${href}>`);
      for (const c of template.children || []) render(c, indent + 1, itemVar);
      emit(`${pad}</${tag}>`);
    } else {
      emit(`${pad}<${template.tag}${cls}>`);
      for (const c of template.children || []) render(c, indent + 1, itemVar);
      emit(`${pad}</${template.tag}>`);
    }
  };

  render(tree, 0);

  // ---- assemble ---------------------------------------------------------
  const arraysNote = arrays.length ? ` Arrays: ${arrays.map((a) => `\`${a.name}\``).join(", ")}.` : "";
  const doc = [
    "/**",
    ` * ${label} — migrated from ${source} by wp-migrator.`,
    " *",
    ` * Baked in: layout, spacing, typography. Props: text, images, links, colours.${arraysNote}`,
    " */",
  ].join("\n");

  // A rest element can't be followed by a trailing comma in a destructuring
  // pattern — only the non-rest entries get one.
  const destructuredLines = destructured.map((d) => (d.startsWith("...") ? `  ${d}` : `  ${d},`));
  const frontmatter = [
    doc,
    ...(usesButton ? ['import Button from "@core-elements/button/Button.astro";'] : []),
    ...(usesIcon ? ['import Icon from "@core-elements/icon/Icon.astro";'] : []),
    "const {",
    ...destructuredLines,
    "} = Astro.props;",
    ...colorConsts,
    ...listDecls,
    ...rawConsts,
  ].join("\n");

  return `---\n${frontmatter}\n---\n${lines.join("\n")}\n<style>\n${css}\n</style>\n`;
}
