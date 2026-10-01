import { NextResponse, type NextRequest } from "next/server";
import { privateAccess } from "./lib/private-access";

export function proxy(request: NextRequest) {
  return privateAccess(request) ?? NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
