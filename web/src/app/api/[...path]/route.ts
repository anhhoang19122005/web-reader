import { privateAccess } from "../../../lib/private-access";

export const runtime = "nodejs";
export const maxDuration = 300;

async function forward(request: Request, context: RouteContext<"/api/[...path]">) {
  const denied = privateAccess(request);
  if (denied) return denied;
  const base = process.env.API_INTERNAL_URL;
  const token = process.env.API_ACCESS_TOKEN;
  if (!base || !token) return Response.json({ message: "API chưa được cấu hình." }, { status: 503 });
  const { path } = await context.params;
  const target = new URL(`${base.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`);
  target.search = new URL(request.url).search;
  const headers = new Headers({ "X-Reader-Token": token, "Accept-Encoding": "identity" });
  for (const name of ["content-type", "range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers, cache: "no-store", redirect: "error",
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(240_000),
    });
    const output = new Headers({ "Cache-Control": "private, no-store" });
    for (const name of ["content-type", "content-range", "accept-ranges"]) {
      const value = response.headers.get(name);
      if (value) output.set(name, value);
    }
    const length = response.headers.get("content-length");
    if (length && !response.headers.has("content-encoding")) output.set("Content-Length", length);
    return new Response(response.body, { status: response.status, headers: output });
  } catch {
    return Response.json({ message: "Máy chủ trên máy tính đang offline hoặc tunnel đã đổi địa chỉ." }, { status: 502 });
  }
}

export { forward as GET, forward as HEAD, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
