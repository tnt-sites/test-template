import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { validateConfig } from "./schema.mjs";

export const CONFIG_FILENAME = "migration.config.yml";
export const COMPONENT_MAP_FILENAME = "component-map.yml";
export const ARTIFACT_DIR = ".migration";

/** Walk up from `cwd` looking for a migration config. */
export function findConfigFile(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function loadPreset(name) {
  // Bare names resolve to the bundled presets; anything else is a path.
  const bundled = new URL(`../../presets/${name}.mjs`, import.meta.url);
  const url = /[./]/.test(name) ? pathToFileURL(path.resolve(name)) : bundled;
  const mod = await import(url.href);
  return mod.default;
}

/**
 * Load and validate the migration config.
 *
 * Returns the parsed config plus the resolved paths every command needs, so no
 * command has to re-derive where the site repo or artifact dir lives.
 */
export async function loadConfig({ cwd = process.cwd(), configPath } = {}) {
  const file = configPath ? path.resolve(configPath) : findConfigFile(cwd);
  if (!file) {
    throw new Error(
      `No ${CONFIG_FILENAME} found in ${cwd} or any parent directory. Run \`mig init\` first.`
    );
  }

  const raw = YAML.parse(fs.readFileSync(file, "utf8")) ?? {};
  const config = validateConfig(raw);

  const configDir = path.dirname(file);
  const targetRoot = path.resolve(configDir, config.target.root);
  const preset = await loadPreset(config.target.preset);

  const componentMapPath = path.join(configDir, COMPONENT_MAP_FILENAME);
  const componentMap = fs.existsSync(componentMapPath)
    ? YAML.parse(fs.readFileSync(componentMapPath, "utf8")) ?? {}
    : { clusters: {} };

  return {
    config,
    preset,
    componentMap,
    paths: {
      configFile: file,
      configDir,
      targetRoot,
      componentMapPath,
      artifacts: path.join(configDir, ARTIFACT_DIR),
      components: path.join(targetRoot, preset.componentsDir),
      content: path.join(targetRoot, preset.contentDir),
      styles: path.join(targetRoot, preset.stylesDir),
      data: path.join(targetRoot, preset.dataDir),
      public: path.join(targetRoot, preset.publicDir),
    },
  };
}

/**
 * Resolve the source base to something fetchable. A `file:` base is served
 * locally by `mig serve`; everything else is used as-is.
 */
export function resolveSourceBase(config, configDir) {
  const base = config.source.base;
  if (base.startsWith("file:")) {
    return { kind: "local", dir: path.resolve(configDir, base.slice("file:".length)) };
  }
  return { kind: "remote", url: base.replace(/\/$/, "") };
}
