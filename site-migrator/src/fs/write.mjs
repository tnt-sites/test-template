import fs from "node:fs";
import path from "node:path";
import { merge as diff3Merge } from "node-diff3";
import {
  baselinePathFor,
  isFrozen,
  parseHeader,
  stampHeader,
  stripHeader,
  hashBody,
} from "./provenance.mjs";

/**
 * The single chokepoint for every byte the toolkit writes into a site repo.
 *
 * Nothing else in the codebase touches the target tree. That invariant is what
 * makes `--dry-run` trustworthy and what guarantees a re-run can never silently
 * destroy hand-tuned work: the decision table below is the only path to disk.
 */

export const Outcome = {
  CREATED: "created",
  UNCHANGED: "unchanged",
  UPDATED: "updated",
  MERGED: "merged",
  CONFLICT: "conflict",
  ADOPTED_EXTERNAL: "adopted-external",
  FROZEN: "frozen",
};

/** Outcomes that mean the operator has to look at something. */
export const NEEDS_ATTENTION = new Set([Outcome.CONFLICT, Outcome.ADOPTED_EXTERNAL]);

export class Writer {
  constructor({
    targetRoot,
    artifactsDir,
    dryRun = false,
    force = false,
    /**
     * Overwrite files that exist but carry no provenance.
     *
     * Off by default, so a re-run can never clobber hand-authored work. Turned
     * on for content, where the starter template ships demo pages under the
     * same names the migrated site needs (`index.md`, `about-us.md`) — refusing
     * to replace those leaves the template's placeholder pages live and the
     * real content unwritten. Frozen files still win either way.
     */
    adoptExternal = false,
    version = "0.1.0",
  }) {
    this.targetRoot = targetRoot;
    this.artifactsDir = artifactsDir;
    this.dryRun = dryRun;
    this.force = force;
    this.adoptExternal = adoptExternal;
    this.version = version;
    this.results = [];
  }

  #record(filePath, outcome, detail) {
    const entry = {
      path: path.relative(this.targetRoot, filePath),
      outcome,
      ...(detail ? { detail } : {}),
    };
    this.results.push(entry);
    return entry;
  }

  #readIfExists(p) {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  }

  #commit(filePath, content) {
    if (this.dryRun) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");

    const baselinePath = baselinePathFor(this.artifactsDir, this.targetRoot, filePath);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, content, "utf8");
  }

  /**
   * Proposals and conflict reports go to the artifact directory, mirroring the
   * repo layout — never next to the file they refer to.
   *
   * A stray `page.md.mig-new` beside `page.md` is picked up by content-collection
   * globs and build tooling, and it litters a tree that is supposed to be left
   * clean when the toolkit is removed.
   */
  #writeSidecar(filePath, suffix, content) {
    if (this.dryRun) return;
    const rel = path.relative(this.targetRoot, filePath);
    const target = path.join(this.artifactsDir, "proposals", `${rel}${suffix}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return target;
  }

  /** Where a proposal for this file would be written. */
  proposalPathFor(filePath, suffix = ".mig-new") {
    const rel = path.relative(this.targetRoot, path.resolve(this.targetRoot, filePath));
    return path.join(this.artifactsDir, "proposals", `${rel}${suffix}`);
  }

  /**
   * Write a generated file.
   *
   * The decision table, in order:
   *   1. frozen                      -> skip entirely
   *   2. no baseline, file exists    -> never overwrite; emit `.mig-new`
   *   3. no baseline, no file        -> create
   *   4. disk == baseline            -> safe to replace
   *   5. disk != baseline            -> 3-way merge; conflict emits `.mig-new`
   */
  write(filePath, body, fields = {}) {
    const abs = path.resolve(this.targetRoot, filePath);
    const next = stampHeader(abs, body, { v: this.version, ...fields });

    const current = this.#readIfExists(abs);
    const baselinePath = baselinePathFor(this.artifactsDir, this.targetRoot, abs);
    const baseline = this.#readIfExists(baselinePath);

    if (current !== null && isFrozen(parseHeader(abs, current)) && !this.force) {
      return this.#record(abs, Outcome.FROZEN);
    }

    if (current === null) {
      this.#commit(abs, next);
      return this.#record(abs, Outcome.CREATED);
    }

    if (baseline === null && !this.force && !this.adoptExternal) {
      // A file we've never written already exists. It may be hand-authored or
      // from an older toolkit run whose baseline was discarded — either way,
      // overwriting it is not ours to decide.
      if (stripHeader(abs, current) === body) {
        return this.#record(abs, Outcome.UNCHANGED);
      }
      this.#writeSidecar(abs, ".mig-new", next);
      return this.#record(
        abs,
        Outcome.ADOPTED_EXTERNAL,
        "file exists but was not written by the toolkit; proposal saved under .migration/proposals/"
      );
    }

    if (current === next) {
      // Refresh the baseline even on a no-op so a discarded baseline heals.
      if (baseline !== current) this.#commit(abs, next);
      return this.#record(abs, Outcome.UNCHANGED);
    }

    if (this.force || this.adoptExternal || baseline === current) {
      this.#commit(abs, next);
      return this.#record(abs, Outcome.UPDATED);
    }

    // Diverged: keep the human's edits, layer ours on top.
    const merged = diff3Merge(
      stripHeader(abs, current).split("\n"),
      stripHeader(abs, baseline).split("\n"),
      body.split("\n")
    );

    if (!merged.conflict) {
      const mergedBody = merged.result.join("\n");
      this.#commit(abs, stampHeader(abs, mergedBody, { v: this.version, ...fields }));
      return this.#record(abs, Outcome.MERGED);
    }

    this.#writeSidecar(abs, ".mig-new", next);
    this.#writeSidecar(
      abs,
      ".mig-conflict.diff",
      merged.result.join("\n")
    );
    return this.#record(
      abs,
      Outcome.CONFLICT,
      "hand edits conflict with regeneration; see .migration/proposals/"
    );
  }

  /**
   * Write a non-generated asset (image, font). No provenance header is
   * possible, so ownership is by content hash only.
   */
  writeBinary(filePath, buffer) {
    const abs = path.resolve(this.targetRoot, filePath);
    const baselinePath = baselinePathFor(this.artifactsDir, this.targetRoot, abs);

    if (fs.existsSync(abs)) {
      const currentHash = hashBody(fs.readFileSync(abs).toString("binary"));
      const nextHash = hashBody(buffer.toString("binary"));
      if (currentHash === nextHash) return this.#record(abs, Outcome.UNCHANGED);

      const baselineExists = fs.existsSync(baselinePath);
      if (!baselineExists && !this.force) {
        return this.#record(abs, Outcome.ADOPTED_EXTERNAL, "existing asset left untouched");
      }
    }

    if (!this.dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buffer);
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, buffer);
    }
    return this.#record(abs, fs.existsSync(abs) ? Outcome.UPDATED : Outcome.CREATED);
  }

  get summary() {
    const counts = {};
    for (const r of this.results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    return counts;
  }

  get needsAttention() {
    return this.results.filter((r) => NEEDS_ATTENTION.has(r.outcome));
  }

  /** True if the run should exit non-zero. */
  get failed() {
    return this.results.some((r) => r.outcome === Outcome.CONFLICT);
  }
}
