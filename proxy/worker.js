// Optional Cloudflare Worker: lets the GitHub Pages copy of the app read the
// vNAS data API, which does not allow cross-origin calls from a web page.
// Read-only, limited to the endpoints the app uses, and to your site's origin.
//
// Set ALLOWED_ORIGIN to your Pages origin, e.g. https://yourname.github.io
const ALLOWED_ORIGIN = "https://YOUR-USERNAME.github.io";
const UPSTREAM = "https://data-api.vnas.vatsim.net";
const ALLOWED_PATHS = [/^\/api\/artccs\/[A-Z0-9]{3}$/, /^\/api\/training\/[A-Za-z0-9/_-]+$/, /^\/Files\/NavData\.dat$/];

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, Vary: "Origin" };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
    }
    if (request.method !== "GET") return new Response("Read-only", { status: 405, headers: cors });
    if (origin && origin !== ALLOWED_ORIGIN) return new Response("Origin not allowed", { status: 403 });
    const path = new URL(request.url).pathname;
    if (!ALLOWED_PATHS.some((re) => re.test(path))) return new Response("Not found", { status: 404, headers: cors });
    const upstream = await fetch(UPSTREAM + path);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};
