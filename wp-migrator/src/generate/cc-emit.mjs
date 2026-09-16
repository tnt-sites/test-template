/**
 * CloudCannon scaffolding for a generated component: the inputs file, the
 * structure-value file (what makes the component addable in the CMS), and the
 * snippets file. Emitted YAML is machine-generated but must match the target
 * repo's conventions exactly — including the rule that `_structures` blocks
 * come AFTER `_inputs_from_glob` in structure-value files (CloudCannon applies
 * them in document order and the glob is ignored otherwise).
 */

import YAML from "yaml";
import { kebabToSnake, titleCase } from "./names.mjs";
import { COLOR_OPTIONS } from "./color-palette.mjs";

const yamlOpts = { lineWidth: 0 };

const INPUT_TYPES = {
  text: { type: "text" },
  textarea: { type: "textarea" },
  html: { type: "html" },
  image: { type: "image" },
  url: { type: "url" },
  color: { type: "color" },
  // Colour props are a palette dropdown, not a free hex field, so a rebrand in
  // branding.json carries through every migrated section. The paired
  // `<name>Hex` input (plain `color`) overrides it for one-off shades.
  colorSelect: { type: "select", options: { values: COLOR_OPTIONS } },
};

function inputFor(prop) {
  if (prop.input === "colorSelect") {
    return {
      type: "select",
      comment: `${titleCase(prop.name.replace(/Color$/, ""))} colour, from the site palette.`,
      // Fresh copy per input: CloudCannon reads these as plain YAML, but a
      // shared array would alias across every colour input in the file.
      options: { values: COLOR_OPTIONS.map((o) => ({ ...o })) },
    };
  }
  if (prop.input === "color" && prop.forProp) {
    return {
      type: "color",
      comment: `Optional custom hex that overrides the ${prop.forProp} selection.`,
    };
  }
  return { ...(INPUT_TYPES[prop.input] || { type: "text" }) };
}

function pickIcon({ props, flags = [] }) {
  if (flags.includes("form")) return "edit_note";
  if (flags.includes("carousel")) return "view_carousel";
  const array = props.find((p) => p.kind === "array");
  if (array) return "grid_view";
  const hasImage = props.some((p) => p.kind === "image");
  const hasText = props.some((p) => p.kind === "html" || p.kind === "text");
  if (hasImage && hasText) return "vertical_split";
  if (hasImage) return "panorama";
  return "interests";
}

function describe({ name, props }) {
  const array = props.find((p) => p.kind === "array");
  const bits = [];
  if (props.some((p) => p.name === "heading")) bits.push("heading");
  if (props.some((p) => p.kind === "html" || (p.kind === "text" && p.name.startsWith("text"))))
    bits.push("copy");
  if (array) bits.push(`editable ${array.name}`);
  else if (props.some((p) => p.kind === "image")) bits.push("imagery");
  return `${titleCase(name)} section${bits.length ? ` with ${bits.join(", ")}` : ""}. Migrated by wp-migrator.`;
}

/** Default value a prop gets in the structure-value (what a fresh insert looks like). */
function structureDefault(prop, values, backgroundImageProp) {
  if (prop.kind === "array") {
    const item = {};
    for (const ip of prop.itemProps) item[ip.name] = "";
    return [item];
  }
  if (prop.kind === "color" || prop.kind === "colorHex") return values[prop.name] ?? "";
  if (prop.name === backgroundImageProp?.name) return values[prop.name] ?? "";
  return "";
}

export function emitInputs({ name, props }) {
  const inputs = {};
  const structures = {};

  for (const prop of props) {
    if (prop.kind === "array") {
      const structureKey = `${kebabToSnake(name)}_item`;
      inputs[prop.name] = {
        type: "array",
        options: { structures: `_structures.${structureKey}` },
      };
      const itemValue = {};
      const itemInputs = {};
      for (const ip of prop.itemProps) {
        itemValue[ip.name] = "";
        itemInputs[ip.name] = inputFor(ip);
      }
      structures[structureKey] = { values: [{ value: itemValue, _inputs: itemInputs }] };
    } else {
      inputs[prop.name] = inputFor(prop);
    }
  }

  const doc = { _inputs: inputs };
  if (Object.keys(structures).length) doc._structures = structures;
  return YAML.stringify(doc, yamlOpts);
}

export function emitStructureValue({ name, namespace, props, values, backgroundImageProp, flags }) {
  const componentPath = `page-sections/${namespace}/${name}`;
  const value = { _component: componentPath, id: "" };
  for (const prop of props) value[prop.name] = structureDefault(prop, values, backgroundImageProp);

  const label = titleCase(name);
  const icon = pickIcon({ props, flags });
  const doc = {
    label,
    icon,
    description: describe({ name, props }),
    value,
    preview: { text: [label], icon },
    picker_preview: { text: label, subtext: describe({ name, props }) },
    _inputs_from_glob: [
      `/src/components/page-sections/${namespace}/${name}/${name}.cloudcannon.inputs.yml`,
    ],
  };
  return YAML.stringify(doc, yamlOpts);
}

export function emitSnippets({ name, namespace }) {
  const doc = {
    _snippets: {
      [kebabToSnake(name)]: {
        template: "astro_component",
        inline: false,
        preview: { text: titleCase(name) },
        definitions: { component_name: `page-sections/${namespace}/${name}` },
        _inputs_from_glob: [
          `/src/components/page-sections/${namespace}/${name}/${name}.cloudcannon.inputs.yml`,
        ],
      },
    },
  };
  return YAML.stringify(doc, yamlOpts);
}

/** This occurrence's real content, as a pageSections block ready to paste. */
/** The plain JS object for one pageSections entry — for assembling a whole page's array. */
export function blockValue({ name, namespace, props, values }) {
  const block = { _component: `page-sections/${namespace}/${name}`, id: "" };
  for (const prop of props) {
    block[prop.name] = values[prop.name] ?? (prop.kind === "array" ? [] : "");
  }
  return block;
}

export function emitBlock(args) {
  return YAML.stringify([blockValue(args)], yamlOpts);
}

/** A full page's front matter: title/description/canonical + every section's block. */
export function emitPage({ title, description = "", canonical, blocks, mig }) {
  const doc = mig ? { _mig: mig } : {};
  Object.assign(doc, { title, description, canonical, pageSections: blocks });
  return YAML.stringify(doc, yamlOpts);
}
