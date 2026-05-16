import { NextRequest, NextResponse } from "next/server";

const backendBase = process.env.BACKEND_API_BASE ?? "http://127.0.0.1:4000";

// Required so Next.js doesn't buffer the SSE stream.
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  // SSE: pass the stream straight through rather than buffering.
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return sseProxy(request, context);
  }
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

function sharedHeaders() {
  return {
    "x-user-role": "owner",
    ...(process.env.API_AUTH_TOKEN ? { authorization: `Bearer ${process.env.API_AUTH_TOKEN}` } : {})
  };
}

async function sseProxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const target = new URL(`/${path.join("/")}`, backendBase);

  const upstream = await fetch(target, {
    method: "GET",
    headers: { accept: "text/event-stream", ...sharedHeaders() },
    cache: "no-store"
  });

  // Pipe the upstream ReadableStream directly — no buffering.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const target = new URL(`/${path.join("/")}${request.nextUrl.search}`, backendBase);
  const body = request.method === "GET" ? undefined : await request.text();

  const response = await fetch(target, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      ...sharedHeaders()
    },
    body,
    cache: "no-store"
  });

  const text = await response.text();

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
}
