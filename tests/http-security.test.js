import assert from "node:assert/strict";
import test from "node:test";

import {
  createFixedWindowRateLimiter,
  defaultTargetDateTime,
  readJsonBodyLimited,
  staticCacheControl,
  withSecurityHeaders
} from "../lib/http-security.mjs";

test("이미지는 재사용하고 HTML과 해시 없는 스크립트는 변경을 확인한다", () => {
  assert.equal(staticCacheControl("/assets/illustrations/rail-air-journey.webp"), "public, max-age=3600");
  assert.equal(staticCacheControl("/src/app-ABCDEFG2.js"), "public, max-age=31536000, immutable");
  for (const path of ["/", "/app-shell.html", "/src/app.js", "/api/data/fusion", "/missing"]) {
    assert.equal(staticCacheControl(path), "no-cache");
  }
});

test("실제 읽은 바이트 수가 제한을 넘으면 Content-Length 없이도 거부한다", async () => {
  const request = new Request("https://chakchak.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "가".repeat(100) })
  });
  request.headers.delete("content-length");

  await assert.rejects(
    readJsonBodyLimited(request, 64),
    (error) => error?.message === "PAYLOAD_TOO_LARGE" && error?.status === 413
  );
});

test("JSON이 아닌 단순 텍스트 요청은 브라우저 간 비용 유발 요청을 막기 위해 거부한다", async () => {
  const request = new Request("https://chakchak.test/api", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ question: "지금 무엇을 해야 해?" })
  });

  await assert.rejects(
    readJsonBodyLimited(request),
    (error) => error?.message === "UNSUPPORTED_MEDIA_TYPE" && error?.status === 415
  );
});

test("고정 구간 호출 제한은 한도를 넘긴 요청과 재시도 시간을 반환한다", () => {
  const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal(limiter.take("client", 1_000).allowed, true);
  assert.equal(limiter.take("client", 2_000).allowed, true);
  const blocked = limiter.take("client", 3_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 58);
  assert.equal(limiter.take("client", 61_000).allowed, true);
});

test("호출 제한 저장소가 가득 차면 새 식별자를 거부해 메모리 증가를 막는다", () => {
  const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000, maxEntries: 2 });
  assert.equal(limiter.take("client-a", 1_000).allowed, true);
  assert.equal(limiter.take("client-b", 1_000).allowed, true);
  const saturated = limiter.take("client-c", 2_000);
  assert.equal(saturated.allowed, false);
  assert.equal(saturated.saturated, true);
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.take("client-c", 61_000).allowed, true);
});

test("공개 응답에는 클릭재킹·권한·참조 정보 방어 헤더가 포함된다", async () => {
  const response = withSecurityHeaders(new Response("ok", { headers: { "content-type": "text/plain" } }));
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
  assert.match(response.headers.get("permissions-policy"), /camera=\(\)/);
  assert.equal(await response.text(), "ok");
});

test("데이터 융합 기본 시각은 고정된 과거 날짜가 아니라 현재 한국 시각을 사용한다", () => {
  assert.equal(defaultTargetDateTime(new Date("2026-08-30T00:00:00.000Z")), "2026-08-30T09:00:00+09:00");
});
