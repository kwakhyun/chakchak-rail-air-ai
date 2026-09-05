import { expect, test } from "@playwright/test";

const fusion = { sources: [], sourceSummary: { live: 0, demo: 7 }, overallMode: "demo" };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-09-05T07:00:00Z"));
  await page.route("**/api/data/fusion?**", route => route.fulfill({ json: fusion }));
});

test("막차 이후에는 추천과 저장 대신 연결 불가 상태가 나온다", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-09-05T14:00:00Z"));
  await page.goto("/?mode=live");
  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  await page.locator("#journey-arrival").fill("2030-09-05T23:00");
  await page.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await expect(page.getByRole("heading", { name: "연결 가능한 열차를 찾지 못했어요" })).toBeVisible();
  for (const name of ["다음 열차", "여행 일정"]) {
    await page.locator(".topnav").getByRole("button", { name, exact: true }).click();
    await expect(page.getByText("더 여유 있는 열차를 찾았어요", { exact: true })).toHaveCount(0);
    await expect(page.locator("#apply-recovery")).toHaveCount(0);
  }
});

test("응답 중에 작성한 입력과 체크박스, 열린 창을 보존한다", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/data/fusion?**", async route => { await pending; await route.fulfill({ json: fusion }); });
  await page.goto("/?mode=live");
  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  await page.locator("#journey-flight").fill("EDIT123");
  await page.locator("#journey-large-luggage").check();
  const response = page.waitForResponse(r => r.url().includes("/api/data/fusion"));
  release();
  await response;
  await expect(page.getByRole("dialog", { name: "항공편과 여행조건을 알려주세요" })).toBeVisible();
  await expect(page.locator("#journey-flight")).toHaveValue("EDIT123");
  await expect(page.locator("#journey-large-luggage")).toBeChecked();
});

test("이전 안내 응답이 바뀐 여정에 다시 나타나지 않는다", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/ai/concierge", async route => {
    await pending;
    await route.fulfill({ json: { mode: "fallback", guidance: { headline: "OLD_JOURNEY_RESPONSE" } } }).catch(() => {});
  });
  await page.goto("/?mode=live");
  await page.getByRole("button", { name: "쉬운 안내 받기" }).click();
  await page.getByRole("button", { name: "35분 늦어졌을 때 보기" }).click();
  release();
  await expect(page.locator("body")).not.toContainText("OLD_JOURNEY_RESPONSE");
  await expect(page.locator("#request-ai")).toBeEnabled();
});

test("늦은 이전 데이터가 최신 항공편의 출발지를 덮어쓰지 않는다", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/data/fusion?**", async route => {
    const latest = new URL(route.request().url()).searchParams.get("flight") === "NEW123";
    if (!latest) await pending;
    await route.fulfill({ json: { ...fusion, sources: [{ id: "incheon-flight", mode: "live", data: { origin: latest ? "새 출발지" : "이전 출발지", scheduledTime: "1705", terminal: "P03" } }] } }).catch(() => {});
  });
  await page.goto("/?mode=live");
  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  await page.locator("#journey-flight").fill("NEW123");
  await page.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await expect(page.locator("#view-title")).toContainText("새 출발지");
  release();
  await expect(page.locator("#view-title")).not.toContainText("이전 출발지");
});

test("행동 버튼과 확률은 일관되고 모바일 모든 메뉴에 가로 넘침이 없다", async ({ page }) => {
  await page.goto("/?mode=live");
  const action = page.locator(".possibility-card [data-open-recovery]");
  await expect(action).toBeVisible();
  const rect = await action.boundingBox();
  expect(rect!.y).toBeLessThan(720);
  await page.locator(".journey-model-disclosure > summary").click();
  const model = await page.locator(".model-score-card > strong").textContent();
  const card = await page.locator(".confidence-gauge > strong").textContent();
  expect(model?.replace(/\s/g, "")).toBe(card?.replace(/\s/g, ""));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["내 이동", "다음 열차", "여행 일정", "이동 기록"]) {
    await page.locator(".mobile-nav").getByRole("button", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
  await page.getByRole("button", { name: "서비스 안내", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("밤에 접속해도 기본값과 시간표 조회는 다음 날을 사용한다", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-09-05T12:04:00Z"));
  const request = page.waitForRequest(r => r.url().includes("/api/data/fusion?"));
  await page.goto("/?mode=live");
  expect(new URL((await request).url()).searchParams.get("at")).toBe("2030-09-06T17:05:00+09:00");
  await expect(page.getByRole("heading", { name: /한눈에/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "연결 가능한 열차를 찾지 못했어요" })).toHaveCount(0);
  await expect(page.locator(".journey-heading .eyebrow")).toContainText("9월 6일");
  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  await expect(page.locator("#journey-arrival")).toHaveValue("2030-09-06T17:05");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.locator(".topnav").getByRole("button", { name: "다음 열차", exact: true }).click();
  await expect(page.locator(".schedule-source")).toContainText("9월 6일");
  await expect(page.getByRole("heading", { name: "탈 수 있는 열차부터 보여드려요" })).toBeVisible();
});

test("다음 날 공식 열차가 항공 도착보다 빨라도 시간표는 표시한다", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-09-05T12:04:00Z"));
  await page.route("**/api/data/fusion?**", route => route.fulfill({ json: { ...fusion, sources: [{ id: "tago-train", mode: "live", data: [{ trainNo: "00513", departureStation: "서울", arrivalStation: "전주", departureTime: "20300906121900", arrivalTime: "20300906140100", adultFare: 34600 }] }] } }));
  await page.goto("/?mode=live");
  await expect(page.getByRole("heading", { name: "서울에서 전주까지 열차 시간표" })).toBeVisible();
  await expect(page.locator(".timetable-list")).toContainText("12:19");
  await expect(page.locator(".timetable-list")).toContainText("공식 시간표");
  await expect(page.getByRole("heading", { name: "연결 가능한 열차를 찾지 못했어요" })).toHaveCount(0);
  await page.locator(".topnav").getByRole("button", { name: "다음 열차", exact: true }).click();
  await expect(page.locator(".timetable-list")).toContainText("KTX 00513");
  await expect(page.locator("#apply-recovery")).toHaveCount(0);
});

test("예시 여정은 외부 응답 없이 유지되고 실제 조회로 전환할 수 있다", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/data/fusion?**", route => {
    requests++;
    return route.fulfill({ json: { ...fusion, sources: [{ id: "incheon-flight", mode: "live", data: { origin: "실제 출발지", scheduledTime: "1630", estimatedTime: "1650", terminal: "P01" } }] } });
  });
  await page.goto("/");
  await expect(page.locator(".journey-heading")).toContainText("예시 항공편 KE704");
  await expect(page.locator(".journey-heading")).toContainText("17:05");
  await expect(page.locator(".mode-pill")).toHaveText("예시 여정 체험");
  await expect(page.locator(".possibility-card")).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  await page.locator("#journey-live-flight").check();
  await page.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await expect(page.locator("#view-title")).toContainText("실제 출발지");
  expect(requests).toBe(1);
});

test("기본 체험은 대체편 저장과 여행 일정까지 이어지고 새로고침 후 유지된다", async ({ page }) => {
  let liveRequests = 0;
  await page.route("**/api/data/fusion?**", route => { liveRequests++; return route.abort(); });
  await page.goto("/");
  await expect(page.locator(".trip-card")).toBeVisible();
  await page.locator(".topnav").getByRole("button", { name: "다음 열차", exact: true }).click();
  await expect(page.locator(".journey-scene-image")).toBeVisible();
  const title = await page.locator("#view-title").boundingBox();
  const picker = await page.locator(".routes-scenario-picker").boundingBox();
  expect(title!.x + title!.width).toBeLessThanOrEqual(picker!.x);
  await page.getByRole("button", { name: "대체편·표 보호 순서 확인", exact: true }).click();
  await page.getByRole("button", { name: "대체 일정 후보 저장", exact: true }).click();
  await page.locator(".topnav").getByRole("button", { name: "여행 일정", exact: true }).click();
  await expect(page.locator(".travel-place-card")).toHaveCount(3);
  await page.reload();
  await expect(page.locator(".confirmed-journey-banner")).toBeVisible();
  await expect(page.locator(".travel-place-card")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["내 이동", "다음 열차", "여행 일정", "이동 기록"]) {
    await page.locator(".mobile-nav").getByRole("button", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(page.locator(".timetable-list")).toHaveCount(0);
  }
  expect(liveRequests).toBe(0);
});

test("접힌 상세 정보의 아이콘과 문구는 모든 화면 폭에서 크기와 간격을 유지한다", async ({ page }) => {
  await page.goto("/");
  for (const width of [390, 720, 721, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const selector of [".journey-signal-disclosure", ".journey-model-disclosure"]) {
      const details = page.locator(selector);
      for (const open of [false, true]) {
        await details.evaluate((el, value) => { (el as HTMLDetailsElement).open = value; }, open);
        const bounds = await details.locator(":scope > summary").evaluate(el => {
          const rect = (s: string) => el.querySelector(s)!.getBoundingClientRect();
          const icon = rect("img"), title = rect("strong"), description = rect("small"), badge = rect(".mobile-disclosure-badge");
          return { iconWidth: icon.width, iconHeight: icon.height, height: el.getBoundingClientRect().height,
            gap: description.top - title.bottom, titleLeft: title.left, iconRight: icon.right, badgeLeft: badge.left, textRight: Math.max(title.right, description.right) };
        });
        expect(bounds.iconWidth).toBe(36);
        expect(bounds.iconHeight).toBe(36);
        expect(bounds.height).toBeLessThan(120);
        expect(bounds.gap).toBeGreaterThanOrEqual(2);
        expect(bounds.titleLeft).toBeGreaterThan(bounds.iconRight);
        expect(bounds.badgeLeft).toBeGreaterThan(bounds.textRight);
      }
      await details.evaluate(el => { (el as HTMLDetailsElement).open = false; });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});
