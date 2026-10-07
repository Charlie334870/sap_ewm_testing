import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/[...path]/route";

const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

afterEach(() => vi.unstubAllGlobals());

function stubApi(
  response = new Response('{"ok":true}', {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  });
  return calls;
}

describe("web proxy to the API", () => {
  it("forwards the session cookie and an agent access token, and nothing it should not", async () => {
    const calls = stubApi();
    await GET(
      new Request("http://localhost:3000/api/v1/agent/context?limit=5", {
        headers: {
          authorization: "Bearer ewm_pat_abc",
          cookie: "ewm_session=xyz",
          "x-internal-secret": "nope",
          host: "localhost:3000",
        },
      }),
      params("v1/agent/context"),
    );
    expect(calls[0]!.url).toBe("http://localhost:4000/api/v1/agent/context?limit=5");
    const sent = new Headers(calls[0]!.init.headers);
    expect(sent.get("authorization")).toBe("Bearer ewm_pat_abc");
    expect(sent.get("cookie")).toBe("ewm_session=xyz");
    expect(sent.get("x-internal-secret")).toBeNull();
  });

  it("passes the body, the status and Set-Cookie back and forth", async () => {
    const calls = stubApi(
      new Response('{"user":{}}', {
        status: 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "ewm_session=new; Path=/; HttpOnly",
        },
      }),
    );
    const res = await POST(
      new Request("http://localhost:3000/api/v1/auth/login", {
        method: "POST",
        body: '{"email":"a@b.c"}',
        headers: { "content-type": "application/json" },
      }),
      params("v1/auth/login"),
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe('{"email":"a@b.c"}');
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()).toEqual(["ewm_session=new; Path=/; HttpOnly"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("says so when the API is down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await GET(
      new Request("http://localhost:3000/api/v1/projects"),
      params("v1/projects"),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});
