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
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
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
  await expect(page.getByRole("heading", { name: /한눈에/, level: 1 })).toBeVisible();
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
  await expect(page.locator(".trip-card .flight-chip")).toContainText("KE704");
  await expect(page.locator(".signal-board")).toContainText("17:05");
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

test("데스크톱은 원래 패널 배치를 유지하고 모바일 상세 정보는 넘치지 않는다", async ({ page }) => {
  await page.goto("/");
  for (const width of [390, 720, 721, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const selector of [".journey-signal-disclosure", ".journey-model-disclosure"]) {
      const details = page.locator(selector);
      if (width > 720) {
        await expect(details).toHaveAttribute("open", "");
        await expect(details.locator(":scope > summary")).toBeHidden();
        await expect(details.locator(".mobile-disclosure-content")).toBeVisible();
        const panel = await details.boundingBox();
        const hero = await page.locator(".journey-hero").boundingBox();
        expect(panel!.y + panel!.height).toBeLessThanOrEqual(hero!.y);
        continue;
      }
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

test("예시 조건과 실제 조회 실패를 구분해 표시한다", async ({ page }) => {
  await page.goto("/");
  const board = page.locator(".signal-board");
  await expect(board).toContainText("예시 여정에 적용한 공항과 철도 조건");
  await expect(board).not.toContainText("조회 불가");
  await expect(board).not.toContainText("0/4");
  await expect(board.locator(".signal-node > em")).toHaveText(["예시 조건", "예시 조건", "예시 조건", "예시 조건"]);
  await page.getByRole("button", { name: "항공편·여행조건 바꾸기" }).click();
  await page.locator("#journey-live-flight").check();
  await page.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await page.locator(".journey-signal-disclosure").evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(board).toContainText("조회 불가");
  await expect(board).toContainText("0/4");
});

test("저장 없이 여행 일정을 바로 조회하고 열차 조회가 비어도 장소와 지도를 볼 수 있다", async ({ page }) => {
  await page.goto("/#travel");
  await expect(page.locator(".travel-place-card")).toHaveCount(3);
  await expect(page.locator("body")).not.toContainText("방문 일정을 확인해 주세요");
  await expect(page.locator(".travel-plan-notice")).toContainText("추천편 기준 미리보기");
  await page.locator(".travel-place-card > summary").first().click();
  await expect(page.getByRole("link", { name: "지도에서 장소 확인" }).first()).toHaveAttribute("href", /map.naver.com/);
  await page.route("**/api/data/fusion?**", route => route.fulfill({ json: { ...fusion, sources: [{id: "tago-train", mode: "unavailable", data: []}, {id: "tour-api", mode: "live", data: [{contentId: "123", title: "조회한 전주 관광지", address: "전주시"}]}] } }));
  await page.goto("/?mode=live#travel");
  await expect(page.locator("#view-title")).toHaveText("전주에서 가볼 만한 곳");
  await expect(page.locator(".travel-place-card")).toContainText("조회한 전주 관광지");
  await expect(page.locator(".travel-place-card")).toContainText("시간 미정");
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});


test("모바일에서 펼친 내용은 재계산과 화면 크기 변경 후에도 유지된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const details = page.locator(".journey-signal-disclosure");
  await details.locator(":scope > summary").click();
  await page.locator("#open-journey-setup").click();
  await page.locator("#journey-bags").selectOption("0");
  await page.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await expect(details).toHaveAttribute("open", "");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(details.locator(":scope > summary")).toBeHidden();
  await expect(details).toHaveAttribute("open", "");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(details).toHaveAttribute("open", "");
  await details.locator(":scope > summary").click();
  await page.locator("#open-journey-setup").click();
  await page.getByRole("button", { name: "이 여정으로 계산하기" }).click();
  await expect(details).not.toHaveAttribute("open", "");
});

test("첫 화면 아이콘은 별도 요청 없이 표시되고 이미지는 재방문 때 재사용된다", async ({ browser, baseURL }) => {
  // Use native resource timing and caching, without the shared clock or request mocks.
  const page = await browser.newPage({ baseURL });
  await page.goto("/");
  await expect(page.locator(".signal-board")).toBeVisible();
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  const first = await page.evaluate(() => ({
    missing: [...document.images].filter(img => !img.naturalWidth).length,
    requests: performance.getEntriesByType("resource").map(r => r.name),
    preload: document.querySelector('link[rel="preload"][as="image"]')?.getAttribute("href")
  }));
  expect(first.missing).toBe(0);
  expect(first.requests.filter(url => url.includes("/assets/icons/"))).toEqual([]);
  expect(first.preload).toBe("/media/illustrations/rail-air-journey.webp");
  await page.reload();
  await expect(page.locator(".signal-board")).toBeVisible();
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  const images = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(r => /\.(webp|png)$/.test(r.name))
    .map(r => ({ name: r.name, bytes: (r as PerformanceResourceTiming).transferSize })));
  expect(images.length).toBeGreaterThanOrEqual(2);
  expect(images.every(img => img.bytes === 0)).toBe(true);
  const missing = await page.request.get("/media/missing-review-image.png");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"]).toBe("no-store");
  await page.close();
});
