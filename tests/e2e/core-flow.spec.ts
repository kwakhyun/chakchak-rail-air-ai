import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-09-05T07:00:00Z"));
  await page.route("**/api/data/fusion?**", route => route.fulfill({ json: { sources: [], sourceSummary: { live: 0, demo: 7 }, overallMode: "demo" } }));
});

test("여행조건부터 지연 재계산과 승차권 보호까지 이어진다", async ({ page }) => {
  const head = await page.request.head("/");
  expect(head.status()).toBe(200);
  expect((await head.body()).byteLength).toBe(0);
  const staticPost = await page.request.post("/", { data: {} });
  expect(staticPost.status()).toBe(405);
  const nonJsonAiPost = await page.request.post("/api/ai/guide", {
    headers: { "content-type": "text/plain" },
    data: JSON.stringify({ question: "지금 무엇을 해야 해?" })
  });
  expect(nonJsonAiPost.status()).toBe(415);

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByRole("heading", { name: /한눈에/ })).toBeVisible();

  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  const setup = page.getByRole("dialog", { name: "항공편과 여행조건을 알려주세요" });
  await expect(setup).toBeVisible();
  await expect(setup.getByRole("checkbox", { name: /이미 예매한 열차표/ })).toBeChecked();
  await setup.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await expect(setup).toBeHidden();

  await page.locator(".topnav").getByRole("button", { name: "다음 열차" }).click();
  await expect(page.getByRole("heading", { name: "탈 수 있는 열차부터 보여드려요" })).toBeVisible();
  await page.getByRole("button", { name: "비행기 35분 늦음" }).click();
  await expect(page.getByText("비행기 35분 지연을 반영했어요.")).toBeVisible();

  await page.getByRole("button", { name: /대체편·표 보호 순서/ }).first().click();
  const recovery = page.getByRole("dialog", { name: "대체 일정과 승차권 처리 순서를 확인하세요" });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText(/자동으로 취소하거나 다시 예매하지 않습니다/)).toBeVisible();
  await expect(recovery.getByRole("button", { name: "대체 일정 후보 저장" })).toBeVisible();
  await recovery.getByRole("button", { name: "지금 일정 유지" }).click();
  await expect(recovery).toBeHidden();
});

test("모바일 핵심 메뉴와 AI 기본 안내에 가로 넘침이 없다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fusionReady = page.waitForResponse((response) => response.url().includes("/api/data/fusion") && response.ok());
  await page.goto("/");
  await fusionReady;
  await expect(page.getByRole("navigation", { name: "모바일 주요 메뉴" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.getByRole("button", { name: "착착 AI 가이드 열기" }).click();
  await page.getByRole("button", { name: "지금 무엇을 해야 해?" }).click();
  await expect(page.getByText("착착 기본 안내")).toBeVisible();

  await page.locator(".mobile-nav").getByRole("button", { name: "다음 열차" }).click();
  await expect(page.getByRole("heading", { name: "탈 수 있는 열차부터 보여드려요" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
