/**
 * Forwards /api/* from the browser to the API service.
 *
 * The browser only ever talks to this web server, so the session cookie is same-origin and the
 * API does not need to be reachable from outside. The API address is read at run time.
 */
export const dynamic = "force-dynamic";

const API_URL = () => process.env.API_INTERNAL_URL ?? "http://localhost:4000";
// "authorization" carries an agent access token: the MCP server reaches the platform through here.
const FORWARDED_REQUEST_HEADERS = [
  "cookie",
  "authorization",
  "content-type",
  "origin",
  "user-agent",
  "x-forwarded-for",
];

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, API_URL());
  target.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "api_unreachable",
          message: "The API service is not reachable. Check that it is running.",
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers({ "cache-control": "no-store" });
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  for (const cookie of upstream.headers.getSetCookie())
    responseHeaders.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
