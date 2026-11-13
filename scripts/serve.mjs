import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  let file = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  if (file === "/") file = "/index.html";
  const full = path.join(root, file);
  if (!full.startsWith(root)) {
    res.writeHead(403);
    res.end("nope");
    return;
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "not found" : "error");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(full)] || "application/octet-stream" });
    res.end(buf);
  });
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => {
  console.log(`Tinnie Index → http://localhost:${port}`);
});
