import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const VNAS = "https://data-api.vnas.vatsim.net";

// The vNAS data API sends no CORS headers, so the browser cannot call it
// directly. `npm run dev` and `npm run preview` both forward GET /vnas/* to it.
const forward: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith("/vnas/")) return next();
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Read-only");
  }
  try {
    const upstream = await fetch(VNAS + req.url.slice("/vnas".length));
    res.statusCode = upstream.status;
    res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
    res.setHeader("cache-control", "private, max-age=300");
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain");
    res.end(`Could not reach vNAS: ${e instanceof Error ? e.message : e}`);
  }
};

const vnasForward = (): Plugin => ({
  name: "vnas-forward",
  configureServer: (server) => void server.middlewares.use(forward),
  configurePreviewServer: (server) => void server.middlewares.use(forward),
});

export default defineConfig({
  plugins: [react(), vnasForward()],
  base: "./",
  server: { port: 5180 },
  preview: { port: 5180 },
});
