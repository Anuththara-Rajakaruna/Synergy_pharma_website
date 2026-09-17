import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "@/lib/http/errors";
import { assertSameOrigin, getClientIp, readJsonBody } from "@/lib/http/request";
import { SITE_URL } from "@/lib/site";
import { withEnv } from "./support/env";

function request(headers: Record<string, string>, init: { method?: string; url?: string; body?: string } = {}): Request {
  return new Request(init.url ?? "http://localhost:3300/api/test", { method: init.method ?? "GET", headers, body: init.body });
}

function expectAppError(fn: () => unknown, status: number, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, String(err));
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

async function expectAppErrorAsync(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, String(err));
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

const noIpConfig = { TRUSTED_IP_HEADER: undefined, TRUSTED_PROXY_COUNT: undefined, VERCEL: undefined };

describe("getClientIp", () => {
  it("returns 'unknown' when no address is available", () => {
    withEnv(noIpConfig, () => assert.equal(getClientIp(request({})), "unknown"));
  });

  it("uses the right-most X-Forwarded-For entry added by the nearest proxy by default", () => {
    withEnv(noIpConfig, () => {
      assert.equal(getClientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
      assert.equal(getClientIp(request({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
    });
  });

  it("honours TRUSTED_PROXY_COUNT and falls back to one hop for invalid values", () => {
    const headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" };
    withEnv({ ...noIpConfig, TRUSTED_PROXY_COUNT: "2" }, () => assert.equal(getClientIp(request(headers)), "203.0.113.9"));
    withEnv({ ...noIpConfig, TRUSTED_PROXY_COUNT: "10" }, () => assert.equal(getClientIp(request(headers)), "6.6.6.6"));
    withEnv({ ...noIpConfig, TRUSTED_PROXY_COUNT: "zero" }, () => assert.equal(getClientIp(request(headers)), "10.0.0.2"));
    withEnv({ ...noIpConfig, TRUSTED_PROXY_COUNT: "0" }, () => assert.equal(getClientIp(request(headers)), "10.0.0.2"));
  });

  it("prefers TRUSTED_IP_HEADER (case-insensitive) and takes its first entry", () => {
    withEnv({ ...noIpConfig, TRUSTED_IP_HEADER: " X-Real-IP " }, () => {
      assert.equal(getClientIp(request({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" })), "198.51.100.7");
      assert.equal(getClientIp(request({ "x-real-ip": "198.51.100.7, 10.0.0.1" })), "198.51.100.7");
      assert.equal(getClientIp(request({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
    });
    withEnv({ ...noIpConfig, TRUSTED_IP_HEADER: "cf-connecting-ip" }, () => {
      assert.equal(getClientIp(request({ "cf-connecting-ip": "198.51.100.8", "x-real-ip": "6.6.6.6" })), "198.51.100.8");
    });
  });

  it("ignores implausible header values", () => {
    withEnv({ ...noIpConfig, TRUSTED_IP_HEADER: "x-real-ip" }, () => {
      assert.equal(getClientIp(request({ "x-real-ip": "<script>alert(1)</script>" })), "unknown");
      assert.equal(getClientIp(request({ "x-real-ip": "a".repeat(46) })), "unknown");
    });
    withEnv(noIpConfig, () => assert.equal(getClientIp(request({ "x-forwarded-for": "evil.example.com" })), "unknown"));
  });

  it("only trusts X-Real-IP on Vercel", () => {
    withEnv({ ...noIpConfig, VERCEL: "1" }, () => {
      assert.equal(getClientIp(request({ "x-real-ip": "198.51.100.9", "x-forwarded-for": "6.6.6.6" })), "198.51.100.9");
    });
    withEnv(noIpConfig, () => {
      assert.equal(getClientIp(request({ "x-real-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.1" })), "203.0.113.1");
    });
  });
});

describe("assertSameOrigin", () => {
  it("does not check safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      assert.doesNotThrow(() => assertSameOrigin(request({ origin: "https://evil.example" }, { method })), method);
    }
  });

  it("allows same-origin browser requests", () => {
    assert.doesNotThrow(() => assertSameOrigin(request({ "sec-fetch-site": "same-origin", origin: "https://evil.example" }, { method: "POST" })));
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: "http://localhost:3300" }, { method: "POST" })));
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: new URL(SITE_URL).origin }, { method: "DELETE" })));
    assert.doesNotThrow(() =>
      assertSameOrigin(
        request({ origin: "https://careers.example.org", "x-forwarded-host": "careers.example.org", "x-forwarded-proto": "https" }, { method: "PATCH" })
      )
    );
  });

  it("allows non-browser clients that send neither Origin nor Sec-Fetch-Site", () => {
    assert.doesNotThrow(() => assertSameOrigin(request({}, { method: "POST" })));
    assert.doesNotThrow(() => assertSameOrigin(request({ "sec-fetch-site": "none" }, { method: "POST" })));
  });

  it("blocks cross-site unsafe requests", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expectAppError(() => assertSameOrigin(request({ origin: "https://evil.example" }, { method })), 403, "cross_site_request");
    }
    expectAppError(() => assertSameOrigin(request({ "sec-fetch-site": "cross-site" }, { method: "POST" })), 403, "cross_site_request");
    expectAppError(() => assertSameOrigin(request({ "sec-fetch-site": "same-site" }, { method: "POST" })), 403, "cross_site_request");
    expectAppError(() => assertSameOrigin(request({ origin: "null" }, { method: "POST" })), 403, "cross_site_request");
    expectAppError(() => assertSameOrigin(request({ origin: "http://localhost:3300.evil.example" }, { method: "POST" })), 403, "cross_site_request");
  });
});

describe("readJsonBody", () => {
  it("parses a JSON object", async () => {
    const body = await readJsonBody(request({ "content-type": "application/json; charset=utf-8" }, { method: "POST", body: "{\"name\":\"සුනිල්\"}" }));
    assert.deepEqual(body, { name: "සුනිල්" });
  });

  it("rejects other content types with 415", async () => {
    await expectAppErrorAsync(readJsonBody(request({ "content-type": "text/plain" }, { method: "POST", body: "{}" })), 415, "unsupported_media_type");
    await expectAppErrorAsync(readJsonBody(request({}, { method: "POST", body: "{}" })), 415, "unsupported_media_type");
  });

  it("rejects oversize bodies with 413 whether or not Content-Length is declared", async () => {
    const big = JSON.stringify({ text: "x".repeat(2048) });
    await expectAppErrorAsync(readJsonBody(request({ "content-type": "application/json" }, { method: "POST", body: big }), 1024), 413, "payload_too_large");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(new TextEncoder().encode("x".repeat(512)));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost:3300/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expectAppErrorAsync(readJsonBody(streamed, 1024), 413, "payload_too_large");
  });

  it("rejects malformed JSON and non-object JSON with 400 invalid_json", async () => {
    for (const body of ["{", "[1,2]", "null", "\"text\"", "42", ""]) {
      await expectAppErrorAsync(readJsonBody(request({ "content-type": "application/json" }, { method: "POST", body })), 400, "invalid_json");
    }
  });
});
