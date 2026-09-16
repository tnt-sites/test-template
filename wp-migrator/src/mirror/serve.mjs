import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mime from "mime";

/**
 * Serve an instrumented mirror so every downstream stage can treat a local
 * export exactly like a live site — same Playwright code path, same URLs, but
 * deterministic and offline.
 */

function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }

  // Containment check: `path.join` alone lets `/../../etc/passwd` escape the
  // root, which the previous toolkit's server allowed.
  const candidate = path.resolve(root, "." + path.posix.normalize(decoded));
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  const tries = [candidate];
  if (!path.extname(candidate)) {
    tries.push(`${candidate}.html`, path.join(candidate, "index.html"));
  }

  for (const t of tries) {
    if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
  }
  return null;
}

export function createServer(root) {
  return http.createServer((req, res) => {
    const file = resolveFile(root, req.url || "/");

    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const body = fs.readFileSync(file);
    res.writeHead(200, {
      "content-type": mime.getType(file) ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  });
}

export function serve(root, port = 8080) {
  return new Promise((resolve, reject) => {
    const server = createServer(root);
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}` });
    });
  });
}

export { resolveFile };
