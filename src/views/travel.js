import { travelPreview } from "../travel-itinerary.js";

export function createTravelViews(context) {
  const { ICONS, confirmedJourneyBanner, escapeHtml, formatTime, plannedTravelItems, state, travelVisualAssets } = context;

function travelCategory(type, index) {
  const catalog = {
    food: { label: "지역 음식", icon: ICONS.travelFood },
    culture: { label: "지역 문화", icon: ICONS.travelCulture },
    experience: { label: "체험", icon: ICONS.travelExperience },
    stay: { label: "숙소와 휴식", icon: ICONS.travelStay }
  };
  if (catalog[type]) return catalog[type];
  return {
    label: state.journey.interests[index % Math.max(1, state.journey.interests.length)] || "지역 추천",
    icon: [ICONS.travelFallback, ICONS.travelExperience, ICONS.travelCulture][index % 3]
  };
}


function travelItemsFor(view) {
  return plannedTravelItems(view, state.signals?.scheduledArrival || state.journey.arrivalAt).map((item, index) => ({
    ...item, category: travelCategory(item.contentType, index), imageUrl: travelVisualAssets.placeFallback
  }));
}


function travelGapLabel(minutes) {
  if (!Number.isFinite(minutes)) return "도착 뒤 바로 시작";
  if (minutes < 60) return `${minutes}분 뒤 시작`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분 뒤 시작` : `${hours}시간 뒤 시작`;
}


function travelHero(view, items) {
  const firstItem = items[0];
  if (!firstItem) return "";
  const arrivalTime = formatTime(view.activeKtx.arrival);
  const gap = Math.round((Date.parse(firstItem.startTime) - Date.parse(view.activeKtx.arrival)) / 60_000);
  const heroTitle = view.isRecovered
    ? "변경된 도착 시각에 맞춰 여행을 이어가세요"
    : `${escapeHtml(state.journey.destination)}역 도착 후 첫 일정을 확인하세요`;
  return `
    <section class="travel-visual-hero" aria-labelledby="travel-visual-title">
      <div class="travel-arrival-board">
        <div class="travel-arrival-copy"><span>도착 후 첫 일정</span><h2 id="travel-visual-title">${heroTitle}</h2><p>열차 도착 이후의 예상 일정입니다. 장소별 영업시간을 확인해 주세요.</p></div>
        <ol class="travel-arrival-steps" aria-label="열차 도착부터 첫 방문까지">
          <li><img src="${ICONS.travelArrival}" alt="" aria-hidden="true" /><span>${escapeHtml(state.journey.destination)}역 도착</span><strong>${arrivalTime}</strong></li>
          <li><img src="${ICONS.travelTime}" alt="" aria-hidden="true" /><span>${firstItem.dayLabel}</span><strong>${escapeHtml(firstItem.time)}</strong></li>
          <li><img src="${ICONS.travelFirstPlace}" alt="" aria-hidden="true" /><span>첫 방문</span><strong>${escapeHtml(firstItem.title)}</strong></li>
        </ol>
        <div class="travel-arrival-result"><strong>${travelGapLabel(gap)}</strong><span>${view.isRecovered ? "변경된 도착 시각을 반영했어요" : "예상 이동시간을 반영했어요"}</span></div>
      </div>
    </section>`;
}


function travelReplanStrip(view, hasLiveTourism) {
  return `
    <section class="travel-replan-strip status-${view.isRecovered ? "watch" : "safe"}" aria-labelledby="travel-replan-title">
      <div><span>${view.isRecovered ? "대체 일정 준비" : "여행 연결 확인"}</span><h2 id="travel-replan-title">${view.isRecovered ? "변경한 열차 도착 이후로 계산했어요" : "열차 도착 이후의 방문 순서를 계산했어요"}</h2><p>${hasLiveTourism ? "공공 관광정보에 나온 장소" : "확인한 대표 장소"}를 열차 도착 시각에 맞춰 배치했습니다. 영업시간을 확인하지 못한 장소는 방문 전 확인이 필요합니다.</p></div>
      <ul aria-label="일정에 반영한 내용"><li>열차 도착 반영</li><li>예상 이동시간 반영</li><li>영업시간 확인 필요</li></ul>
    </section>`;
}


function travelPlaceCard(item, index) {
  const mapQuery = encodeURIComponent(`${item.title} ${item.detail}`);
  return `
    <details class="travel-place-card ${item.changed ? "is-changed" : ""}">
      <summary>
        <span class="travel-place-icon" aria-hidden="true"><img src="${item.category.icon}" alt="" /><b>${index + 1}</b></span>
        <div class="travel-place-copy">
          <div class="travel-place-meta"><span>${item.dayLabel}</span><time>${escapeHtml(item.time)}</time><span class="travel-place-status">${escapeHtml(item.status)}</span></div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
          <span class="travel-place-category">${escapeHtml(item.category.label)}</span>
          <span class="travel-place-more">장소 자세히 보기</span>
        </div>
      </summary>
      <div class="travel-place-detail">
        <div><strong>이 장소를 고른 이유</strong><p>${escapeHtml(item.reason)}</p></div>
        <dl><div><dt>방문 시간</dt><dd>${item.dayLabel} ${escapeHtml(item.time)}</dd></div><div><dt>정보 출처</dt><dd>${escapeHtml(item.source)}</dd></div></dl>
        <a class="button button-soft" href="https://map.naver.com/p/search/${mapQuery}" target="_blank" rel="noreferrer">지도에서 장소 확인</a>
      </div>
    </details>`;
}


function travelPlanSection(view, items) {
  const filteredItems = state.travelDay === "all" ? items : items.filter((item) => item.day === state.travelDay);
  return `
    <section class="travel-plan-section" aria-labelledby="travel-plan-title">
      <div class="travel-plan-heading"><div><span>나의 지역 일정</span><h2 id="travel-plan-title">시간 순서대로 편하게 확인하세요</h2><p>장소를 펼치면 추천 이유와 지도 위치를 더 자세히 볼 수 있어요.</p></div>
        <div class="travel-day-switcher" aria-label="일정 날짜 선택">
          <button type="button" data-travel-day="all" aria-pressed="${state.travelDay === "all"}">전체</button>
          <button type="button" data-travel-day="arrival" aria-pressed="${state.travelDay === "arrival"}">도착한 날</button>
          <button type="button" data-travel-day="next" aria-pressed="${state.travelDay === "next"}">다음 날</button>
        </div>
      </div>
      ${filteredItems.length
        ? `<div class="travel-place-grid">${filteredItems.map((item, index) => travelPlaceCard(item, index)).join("")}</div>`
        : `<div class="travel-plan-empty"><div><strong>이 날짜에는 아직 일정이 없어요</strong><p>전체 일정을 선택하면 준비된 장소를 모두 볼 수 있어요.</p></div><button class="button button-soft" type="button" data-travel-day="all">전체 일정 보기</button></div>`}
    </section>`;
}


function travelView(view) {
  view = travelPreview(view);
  const hasLiveTourism = Boolean(view.signals?.tourismPlaces?.length);
  const items = travelItemsFor(view);
  if (!items.length) {
    const places = view.activities.map((item, index) => ({ ...item, category: travelCategory(item.contentType, index), dayLabel: "방문 후보", time: "시간 미정", status: "위치와 영업시간 확인", reason: "열차 도착 시각을 정한 뒤 방문 시간을 안내합니다. 장소 정보와 지도는 먼저 확인할 수 있어요." }));
    return `<section class="view-heading"><div><span class="eyebrow">여행 일정</span><h1 id="view-title" tabindex="-1">${escapeHtml(state.journey.destination)}에서 가볼 만한 곳</h1><p>${hasLiveTourism ? "조회한 관광지 정보를 먼저 확인하세요." : "대표 장소를 먼저 둘러보세요."}</p></div></section>
      <section class="panel travel-plan-notice"><h2>장소부터 확인해 보세요</h2><p>연결 열차를 정하면 도착 시각에 맞춰 방문 일정을 안내합니다.</p><button class="button button-soft" type="button" data-view-target="routes">열차 시간표 확인</button></section>
      <div class="travel-place-grid">${places.map(travelPlaceCard).join("")}</div>`;
  }
  return `
    <section class="view-heading travel-visual-heading" aria-labelledby="view-title"><div><span class="eyebrow">여행 일정</span><h1 id="view-title" tabindex="-1">열차가 달라져도 ${escapeHtml(state.journey.destination)} 여행은 이어져요</h1><p>새 도착 시간에 맞춰 무리 없는 지역 일정을 다시 연결해요.</p></div><span class="status-pill status-${view.isRecovered ? "watch" : "safe"}">${view.isRecovered ? "대체 일정" : hasLiveTourism ? "공공 관광정보" : "체험 일정"}</span></section>
    ${confirmedJourneyBanner(view, "journey")}
    ${view.isTravelPreview ? `<section class="panel travel-plan-notice"><p><strong>${escapeHtml(view.activeKtx.service)} 추천편 기준 미리보기</strong> · ${formatTime(view.activeKtx.arrival)} 도착 이후의 일정입니다. 열차 선택은 변경되지 않습니다.</p></section>` : ""}
    ${travelHero(view, items)}
    ${travelReplanStrip(view, hasLiveTourism)}
    ${travelPlanSection(view, items)}
    <section class="travel-next-actions" aria-label="다음 행동">
      <div><img src="${ICONS.travelRecheck}" alt="" aria-hidden="true" /><span>열차부터 다시 확인하고 싶나요?</span><strong>${formatTime(view.activeKtx.arrival)} ${escapeHtml(state.journey.destination)}역 도착 일정과 함께 볼 수 있어요.</strong></div>
      <button class="button button-soft" type="button" data-view-target="routes">추천 열차 다시 보기</button>
      <button class="button button-primary" type="button" data-view-target="journey">전체 여정 보기</button>
    </section>`;
}


return { travelCategory, travelItemsFor, travelGapLabel, travelHero, travelReplanStrip, travelPlaceCard, travelPlanSection, travelView };
}
