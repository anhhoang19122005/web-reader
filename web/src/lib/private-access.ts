import { createHash, timingSafeEqual } from "node:crypto";

export function privateAccess(request: Request): Response | null {
  const password = process.env.READER_WEB_PASSWORD;
  if (!password) {
    return process.env.API_INTERNAL_URL ? new Response("Chưa cấu hình mật khẩu.", { status: 503 }) : null;
  }
  const expected = `Basic ${Buffer.from(`reader:${password}`).toString("base64")}`;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash(expected))) return null;
  return new Response("Vui lòng đăng nhập.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Novel Reader", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}
