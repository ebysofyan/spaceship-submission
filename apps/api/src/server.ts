import { join, resolve, sep } from "node:path";

// Repo-relative, so the server works from any cwd.
const WEB_DIST = resolve(import.meta.dir, "../../web/dist");
const INDEX_HTML = join(WEB_DIST, "index.html");

async function serveWeb(pathname: string): Promise<Response> {
  if (!(await Bun.file(INDEX_HTML).exists())) {
    return new Response("Web app not built. Run `bun run build` first.", { status: 404 });
  }
  const filePath = join(WEB_DIST, pathname);
  if (!filePath.startsWith(WEB_DIST + sep) && filePath !== WEB_DIST) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  // SPA fallback: any unknown path serves index.html so client routing works.
  if (pathname !== "/" && (await file.exists())) return new Response(file);
  return new Response(Bun.file(INDEX_HTML));
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  routes: {
    "/api/health": { GET: () => Response.json({ ok: true }) },
  },
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return serveWeb(pathname);
  },
});

console.log(`Server listening on http://localhost:${server.port}`);
