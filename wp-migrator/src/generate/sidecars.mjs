/**
 * Carry a component's CloudCannon sidecars across a rename or a move.
 *
 * These were emitted by the full pipeline, which had the captured tree and knew
 * that a field was a `url` and not a string, an `image` and not a path, a
 * `textarea` and not a one-line box. None of that survives a round trip through
 * the generated `.astro` — reconstructing from markup guesses at it, and the
 * guesses were wrong often enough to matter (an array's item fields vanished
 * entirely when its `.map(` happened to sit on its own line, which empties the
 * array editor in CloudCannon).
 *
 * So the originals are the source of truth and this only edits what the move
 * actually changes: the component's name, its folder, and any renamed props.
 */

import YAML from "yaml";
import { kebabToSnake, titleCase } from "./names.mjs";

// Matches cc-emit.mjs, so a rewritten sidecar is byte-identical to a generated
// one wherever the content is the same.
const yamlOpts = { lineWidth: 0 };

/** Rename an object's keys in place-order, leaving values untouched. */
function renameKeys(obj, rename) {
  if (!obj) return obj;
  const out = {};

  for (const [k, v] of Object.entries(obj)) out[rename[k] ?? k] = v;
  return out;
}

/**
 * `_structures` are keyed `<component>_item`, and the array input points at
 * them by that name, so a component rename has to move both ends together.
 */
function retargetStructures(doc, oldName, newName) {
  if (!doc?._structures) return doc;
  const oldKey = `${kebabToSnake(oldName)}_item`;
  const newKey = `${kebabToSnake(newName)}_item`;

  if (oldKey === newKey) return doc;

  const structures = {};

  for (const [k, v] of Object.entries(doc._structures)) {
    structures[k.startsWith(oldKey) ? newKey + k.slice(oldKey.length) : k] = v;
  }
  doc._structures = structures;

  for (const input of Object.values(doc._inputs ?? {})) {
    const ref = input?.options?.structures;

    if (typeof ref === "string" && ref.includes(oldKey)) {
      input.options.structures = ref.replace(oldKey, newKey);
    }
  }
  return doc;
}

/**
 * `extraProps`: [{ name, input, value }] appended to the inputs and the default
 * value — the per-instance image dimensions lifted out of the merged markup.
 */
export function rewriteSidecars({
  sources,
  oldName,
  newName,
  folder,
  rename = {},
  extraProps = [],
}) {
  const componentPath = `page-sections/${folder}/${newName}`;
  const inputsPath = `/src/components/${componentPath}/${newName}.cloudcannon.inputs.yml`;

  const inputs = YAML.parse(sources.inputs);

  inputs._inputs = renameKeys(inputs._inputs, rename);
  for (const p of extraProps) inputs._inputs[p.name] = { type: p.input };
  retargetStructures(inputs, oldName, newName);

  const structure = YAML.parse(sources.structureValue);

  structure.value = renameKeys(structure.value, rename);
  structure.value._component = componentPath;
  for (const p of extraProps) structure.value[p.name] = p.value;

  const label = titleCase(newName);

  structure.label = label;
  structure.preview = { ...structure.preview, text: [label] };
  structure.picker_preview = { ...structure.picker_preview, text: label };
  structure._inputs_from_glob = [inputsPath];

  const snippets = {
    _snippets: {
      [kebabToSnake(newName)]: {
        template: "astro_component",
        inline: false,
        preview: { text: label },
        definitions: { component_name: componentPath },
        _inputs_from_glob: [inputsPath],
      },
    },
  };

  return {
    inputs: YAML.stringify(inputs, yamlOpts),
    structureValue: YAML.stringify(structure, yamlOpts),
    snippets: YAML.stringify(snippets, yamlOpts),
  };
}
