export function createRoutesViews(context) {
  const { ICONS, confirmedJourneyBanner, decisionProfileFor, demoTrip, displayedProbability, displayedRiskLevel, escapeHtml, formatPercent, formatTime, formatTimeAfterMinutes, journeySceneCatalog, modelPredictionFor, predictionSourceLabel, riskLabel, riskTone, scenarioButtons, state } = context;

function reconciliationPanel(view) {
  const reconciliation = view.chakchakAi.decision?.reconciliation;
  if (!reconciliation) return "";
  const title = reconciliation.status === "OOD_ENGINE_ONLY"
    ? "낯선 상황이라 더 여유 있게 확인했어요"
    : reconciliation.agreement
      ? "도착 상황과 이동 조건을 다시 확인했어요"
      : "결과가 달라 더 안전한 열차를 골랐어요";
  return `
    <div class="recommendation-proof status-${reconciliation.agreement ? "safe" : "watch"}">
      <img src="${ICONS.reconciliation}" alt="" aria-hidden="true" />
      <div><strong>${escapeHtml(title)}</strong><p>항공 도착, 입국장 상황, 짐과 걷는 속도를 함께 살펴 최종 열차를 골랐어요.</p></div>
      <ul aria-label="확인한 내용"><li>도착 상황 확인</li><li>개인 이동 조건 확인</li></ul>
    </div>`;
}


function recommendationDetails(view, candidate) {
  const arex = view.railPlan.airportRail.find((train) => train.id === candidate.id);
  const ktx = view.railPlan.trains.find((train) => train.recommendedArexId === candidate.id);
  const profile = decisionProfileFor(view, candidate);
  const probability = Math.round(displayedProbability(view, candidate));
  const p90Buffer = Math.round(candidate.bufferMinutes.p90);
  const arrivalDelay = Math.max(0, Math.round(profile?.destinationDelayMinutes || 0));
  const waitMinutes = Math.max(0, Math.round(profile?.avoidableWaitMinutes || 0));
  const mobilityValue = state.journey.mobility === "standard" ? "편하게 이동" : "도움 반영";
  const mobilityNote = state.journey.mobility === "standard"
    ? `짐 ${state.journey.checkedBags}개와 보통 걸음을 반영했어요`
    : "걷는 속도와 이동 도움을 반영했어요";
  const recommendationTitle = view.isRecovered
    ? "선택한 열차로 안심하고 이동하세요"
    : view.canRecover
      ? "놓칠 걱정을 줄이는 열차예요"
      : "빠르면서도 탑승 전 여유가 있어요";
  const reasons = [
    { icon: ICONS.reasonSuccess, label: "놓치지 않을 가능성", value: `${probability}%`, note: probability >= 85 ? "여유 있게 탈 수 있어요" : "조금 더 살펴봐야 해요" },
    { icon: ICONS.reasonBuffer, label: "탑승 전 여유", value: p90Buffer >= 0 ? `${p90Buffer}분` : `${Math.abs(p90Buffer)}분 부족`, note: p90Buffer >= 0 ? "입국 지연을 고려한 예상 여유시간이에요" : "다음 열차가 더 안전해요" },
    { icon: ICONS.reasonDestination, label: `${escapeHtml(state.journey.destination)} 도착`, value: formatTime(ktx.arrival), note: arrivalDelay ? `가장 빠른 안전 일정보다 ${arrivalDelay}분 늦어요` : "가장 빠른 안전 일정이에요" },
    { icon: ICONS.reasonMobility, label: "내 이동 조건", value: mobilityValue, note: mobilityNote }
  ];
  return `
    <section class="recommendation-overview" aria-labelledby="recommendation-detail-title">
      <header class="recommendation-overview-head">
        <div class="recommendation-title-block"><span>착착의 추천</span><h2 id="recommendation-detail-title">${recommendationTitle}</h2><p>${formatTime(arex.departure)} 공항철도를 타고 서울역에서 ${escapeHtml(ktx.service)}로 갈아타세요.</p></div>
        <div class="recommendation-confidence tone-${riskTone(displayedRiskLevel(view, candidate))}"><span>놓치지 않을 가능성</span><strong>${probability}%</strong><small>${riskLabel(displayedRiskLevel(view, candidate))}</small></div>
      </header>
      <ol class="recommendation-timeline" aria-label="추천 열차 이동 시간표">
        <li><img src="${ICONS.timelineAirport}" alt="" aria-hidden="true" /><span>인천공항</span><strong>${formatTime(arex.departure)}</strong><small>공항철도 출발</small></li>
        <li><img src="${ICONS.timelineTransfer}" alt="" aria-hidden="true" /><span>서울역</span><strong>${formatTime(ktx.departure)}</strong><small>${escapeHtml(ktx.service)} 출발</small></li>
        <li><img src="${ICONS.timelineDestination}" alt="" aria-hidden="true" /><span>${escapeHtml(state.journey.destination)}역</span><strong>${formatTime(ktx.arrival)}</strong><small>여행 시작</small></li>
      </ol>
      <section class="recommendation-reasons" aria-labelledby="recommendation-reasons-title">
        <div class="recommendation-section-heading"><div><span>추천 이유</span><h3 id="recommendation-reasons-title">중요한 네 가지만 보여드려요</h3></div><p>${waitMinutes ? `기다림은 약 ${waitMinutes}분이에요.` : "불필요하게 기다리지 않아도 돼요."}</p></div>
        <ul class="recommendation-reason-grid">
          ${reasons.map((reason) => `<li><img src="${reason.icon}" alt="" aria-hidden="true" /><span>${reason.label}</span><strong>${reason.value}</strong><small>${reason.note}</small></li>`).join("")}
        </ul>
        <p class="recommendation-summary">${view.canRecover ? "조금 늦게 출발해도 놓칠 걱정을 크게 줄이고, 도착 뒤 여행 일정까지 이어갈 수 있는 선택이에요." : "목적지에는 빠르게 도착하면서 서울역에서 서두르지 않아도 되는 일정이에요."}</p>
      </section>
      <div class="recommendation-actions">
        ${view.canRecover && !view.isRecovered ? `<button class="button button-primary" data-open-recovery type="button">승차권 보호 순서 확인</button>` : ""}
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">코레일에서 좌석 확인</a>
        <a class="button button-plain" href="https://www.arex.or.kr/" target="_blank" rel="noreferrer">공항철도 운행 확인</a>
      </div>
    </section>`;
}


function ticketProtectionPanel(view) {
  const advice = view.ticketProtection;
  if (!advice?.hasBookedTicket) {
    return `
      <section class="panel ticket-protection-empty" aria-labelledby="ticket-protection-title">
        <img src="${ICONS.promiseOfficial}" alt="" aria-hidden="true" />
        <div><span class="eyebrow">승차권 보호</span><h2 id="ticket-protection-title">이미 예매한 표가 있나요?</h2><p>표 종류와 운영사를 알려주면 반환 마감과 안전한 처리 순서를 함께 보여드려요.</p></div>
        <button class="button button-soft" id="open-ticket-setup" type="button">예매한 표 입력</button>
      </section>`;
  }
  return `
    <section class="panel ticket-protection" aria-labelledby="ticket-protection-title">
      <header class="ticket-protection-head">
        <div><span class="eyebrow">예매한 승차권 보호</span><h2 id="ticket-protection-title">대체편을 확인한 뒤 기존 표를 안전하게 처리하세요</h2><p>공항철도와 KTX는 운영사가 달라 각각 확인해야 합니다. 예상 수수료는 범위로 안내합니다.</p></div>
        <span class="ticket-protection-no-auto"><img src="${ICONS.promiseSafety}" alt="" aria-hidden="true" />자동 처리 안 함</span>
      </header>
      <div class="ticket-operator-grid">
        ${advice.operators.map((operator) => `
          <article class="ticket-operator ticket-operator-${operator.id}">
            <header><img src="${operator.id === "arex" ? ICONS.routeArex : ICONS.routeKtx}" alt="" aria-hidden="true" /><div><span>${escapeHtml(operator.label)}</span><strong>${escapeHtml(operator.service)}</strong><small>${escapeHtml(operator.ticketType)}</small></div></header>
            <dl><div><dt>반환 마감</dt><dd>${escapeHtml(operator.deadline)}</dd></div><div><dt>예상 위약금 구간</dt><dd>${escapeHtml(operator.feeBand)}</dd></div></dl>
            <p>${escapeHtml(operator.detail)}</p>
            <a href="${operator.officialUrl}" target="_blank" rel="noreferrer">${escapeHtml(operator.officialLabel)} <span aria-hidden="true">↗</span></a>
          </article>`).join("")}
      </div>
      <section class="ticket-safe-order" aria-labelledby="ticket-safe-order-title">
        <div class="ticket-section-heading"><span>안전한 처리 순서</span><h3 id="ticket-safe-order-title">기존 표를 취소하기 전에 확인하세요</h3></div>
        <ol>${advice.steps.map((step, index) => `<li><span>${index + 1}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div></li>`).join("")}</ol>
      </section>
      <ul class="ticket-risk-checks" aria-label="추가 이동 위험 확인">
        ${advice.checks.map((check) => `<li><span>${escapeHtml(check.label)}</span><strong>${escapeHtml(check.value)}</strong><small>${escapeHtml(check.note)}</small></li>`).join("")}
      </ul>
      <p class="ticket-no-auto-notice"><img src="${ICONS.promiseOfficial}" alt="" aria-hidden="true" /><strong>${escapeHtml(advice.disclaimer)}</strong></p>
    </section>`;
}


function ticketProtectionDialog(view) {
  const advice = view.ticketProtection;
  if (!advice?.hasBookedTicket) {
    return `<p class="recovery-seat-note">예매한 표가 없다면 공식 채널에서 새 좌석과 운임을 확인한 뒤 일정 후보를 저장하세요.</p>`;
  }
  return `
    <section class="recovery-ticket-safety" aria-labelledby="recovery-ticket-safety-title">
      <h3 id="recovery-ticket-safety-title">승차권 변경 전 확인 순서</h3>
      <ol>
        ${advice.steps.slice(0, 3).map((step, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(step.label)}</strong></li>`).join("")}
      </ol>
      <div class="recovery-operator-links">
        ${advice.operators.map((operator) => `<a href="${operator.officialUrl}" target="_blank" rel="noreferrer"><span>${escapeHtml(operator.label)}</span><strong>${escapeHtml(operator.feeBand)}</strong></a>`).join("")}
      </div>
      <p>${escapeHtml(advice.disclaimer)}</p>
    </section>`;
}


function alternativeRouteOption(candidate, view, recommended, index) {
  const arex = view.railPlan.airportRail.find((train) => train.id === candidate.id);
  const ktx = view.railPlan.trains.find((train) => train.recommendedArexId === candidate.id);
  const recommendedKtx = view.railPlan.trains.find((train) => train.recommendedArexId === recommended.id);
  const probability = Math.round(displayedProbability(view, candidate));
  const riskLevel = displayedRiskLevel(view, candidate);
  const p90Buffer = Math.round(candidate.bufferMinutes.p90);
  const arrivalDifference = Math.round((new Date(ktx.arrival).getTime() - new Date(recommendedKtx.arrival).getTime()) / 60000);
  const comparisonLabel = arrivalDifference < 0
    ? `${Math.abs(arrivalDifference)}분 먼저 도착`
    : arrivalDifference > 0
      ? `${arrivalDifference}분 늦게 도착`
      : "같은 시각에 도착";
  const cardLabel = candidate.id === view.primary.id && view.canRecover
    ? "처음 살펴본 열차"
    : arrivalDifference < 0
      ? "더 빠른 열차"
      : "더 여유 있는 열차";
  const explanation = p90Buffer < 0
    ? `입국이 늦어지는 경우를 고려하면 탑승까지 약 ${Math.abs(p90Buffer)}분이 부족할 수 있어요.`
    : `추천 열차와 비교하면 ${comparisonLabel}해요. 공항철도 탑승 전 예상 여유시간은 ${p90Buffer}분이에요.`;
  return `
    <details class="alternative-route-card">
      <summary>
        <span class="alternative-rank">${index + 1}</span>
        <span class="alternative-main"><small>${cardLabel}</small><strong>${formatTime(arex.departure)} 공항철도 · ${escapeHtml(ktx.service)}</strong><span class="alternative-route-meta">${formatTime(ktx.arrival)} ${escapeHtml(state.journey.destination)} 도착 · ${ktx.fareKnown === false ? "운임 공식 확인" : `${ktx.price.toLocaleString("ko-KR")}원 예상`}</span></span>
        <span class="alternative-confidence tone-${riskTone(riskLevel)}"><strong>${probability}%</strong><small>${riskLabel(riskLevel)}</small></span>
      </summary>
      <div class="alternative-route-body">
        <ol aria-label="${escapeHtml(ktx.service)} 이동 시간표">
          <li><span>공항철도 출발</span><strong>${formatTime(arex.departure)}</strong></li>
          <li><span>서울역 출발</span><strong>${formatTime(ktx.departure)}</strong></li>
          <li><span>${escapeHtml(state.journey.destination)} 도착</span><strong>${formatTime(ktx.arrival)}</strong></li>
        </ol>
        <p>${explanation}</p>
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">이 열차 좌석 확인</a>
      </div>
    </details>`;
}


function routeOption(candidate, view, featured = false) {
  const arex = view.railPlan.airportRail.find((train) => train.id === candidate.id);
  const ktx = view.railPlan.trains.find((train) => train.recommendedArexId === candidate.id);
  const isPrimary = candidate.id === view.primary.id;
  const isRecovery = candidate.id === view.recovery.id && view.canRecover;
  const selected = state.confirmedJourney
    ? candidate.id === state.confirmedJourney.selectedArexId
    : isPrimary;
  const badge = selected && view.isRecovered
    ? "선택한 일정"
    : isRecovery && view.canRecover
      ? "더 안전한 추천"
    : isPrimary
      ? "처음 선택한 일정"
      : "다른 시간";
  const p90Buffer = Math.round(candidate.bufferMinutes.p90);
  const probability = displayedProbability(view, candidate);
  const riskLevel = displayedRiskLevel(view, candidate);
  const decisionProfile = decisionProfileFor(view, candidate);

  return `
    <li class="route-option ${featured ? "is-featured" : ""} ${selected ? "is-selected" : ""}">
      <div class="route-option-header">
        <div class="option-title">
          <span class="tag ${isRecovery && view.canRecover ? "tag-accent" : ""}">${badge}</span>
          <strong>${formatTime(arex.departure)} 공항철도 · ${ktx.service}</strong>
          <span>서울역에서 갈아타고 ${formatTime(ktx.arrival)} ${escapeHtml(state.journey.destination)} 도착</span>
        </div>
        <div class="probability tone-${riskTone(riskLevel)}">
          <strong>${formatPercent(probability)}</strong>
          <span>${predictionSourceLabel(view)}</span>
        </div>
      </div>
      <div class="option-line" aria-label="인천공항 ${formatTime(arex.departure)} 출발, 서울역 ${formatTime(ktx.departure)} 출발, ${escapeHtml(state.journey.destination)}역 ${formatTime(ktx.arrival)} 도착">
        <span>공항 ${formatTime(arex.departure)}</span><i aria-hidden="true"></i>
        <span>서울 ${formatTime(ktx.departure)}</span><i aria-hidden="true"></i>
        <span>${escapeHtml(state.journey.destination)} ${formatTime(ktx.arrival)}</span>
      </div>
      <div class="option-meta">
        <span class="tag">${p90Buffer >= 0 ? `예상 여유 ${p90Buffer}분` : `예상 부족 ${Math.abs(p90Buffer)}분`}</span>
        <span class="tag">${riskLabel(riskLevel)}</span>
        ${decisionProfile ? `<span class="tag tag-accent">안전·도착 함께 확인</span>` : ""}
        <span class="tag">${ktx.fareKnown === false ? "운임 공식 확인" : `${ktx.price.toLocaleString("ko-KR")}원 예상`}</span>
      </div>
      ${featured ? `<div class="route-action-row">
        ${isRecovery && view.canRecover && !view.isRecovered ? `<button class="button button-primary" data-open-recovery type="button">승차권 보호 순서 확인</button>` : ""}
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">코레일에서 좌석 확인</a>
        <a class="button button-plain" href="https://www.arex.or.kr/" target="_blank" rel="noreferrer">공항철도 확인</a>
      </div>` : ""}
    </li>`;
}


function decisionGraphic(view, recommended) {
  const primaryProbability = Math.round(displayedProbability(view, view.primary));
  const recommendedProbability = Math.round(displayedProbability(view, recommended));
  const improvement = Math.max(0, recommendedProbability - primaryProbability);
  if (improvement === 0) {
    return `
      <div class="decision-graphic is-steady" role="img" aria-label="현재 열차 탑승 가능성 ${primaryProbability}퍼센트, 안전 기준 85퍼센트">
        <div class="decision-bar is-after"><span><b>현재 열차</b><em>${primaryProbability}%</em></span><i style="--bar:${primaryProbability}%"></i><small>추천 기준보다 탑승 가능성이 ${Math.max(0, primaryProbability - 85)}%p 높아요.</small></div>
        <div class="decision-gain"><strong>${Math.max(0, Math.round(recommended.bufferMinutes.p90))}분</strong><span>예상 여유시간</span></div>
      </div>`;
  }
  return `
    <div class="decision-graphic" role="img" aria-label="처음 열차 ${primaryProbability}퍼센트, 추천 열차 ${recommendedProbability}퍼센트">
      <div class="decision-bar is-before"><span><b>처음 열차</b><em>${primaryProbability}%</em></span><i style="--bar:${primaryProbability}%"></i></div>
      <div class="decision-arrow" aria-hidden="true">→</div>
      <div class="decision-bar is-after"><span><b>추천 열차</b><em>${recommendedProbability}%</em></span><i style="--bar:${recommendedProbability}%"></i></div>
      <div class="decision-gain"><strong>${recommendedProbability}%</strong><span>탑승 가능성 ${improvement}%p 증가</span></div>
    </div>`;
}


function journeySceneForDestination(destination) {
  return journeySceneCatalog[destination] || journeySceneCatalog.전주;
}


function previewDelayLabel(minutes) {
  return minutes > 0 ? `${minutes}분 지연` : "지연 없음";
}


function mobileRouteBoard(view, recommended, recommendedArex, recommendedKtx, p90Time, bufferMinutes) {
  const probability = Math.round(displayedProbability(view, recommended));
  const riskLevel = displayedRiskLevel(view, recommended);
  const steps = [
    { icon: ICONS.routeAirport, label: "인천공항 도착", value: formatTime(view.signals?.scheduledArrival || state.journey.arrivalAt), note: view.signals?.terminal || "터미널 확인" },
    { icon: ICONS.routeArex, label: "공항철도 출발", value: formatTime(recommendedArex.departure), note: `타는 곳 ${p90Time} 도착 예상` },
    { icon: ICONS.routeKtx, label: `${recommendedKtx.service} 출발`, value: formatTime(recommendedKtx.departure), note: "서울역에서 갈아타기" },
    { icon: ICONS.routeDestination, label: `${escapeHtml(state.journey.destination)} 도착`, value: formatTime(recommendedKtx.arrival), note: "지역 일정까지 연결" }
  ];
  return `
    <div class="mobile-route-board" aria-label="추천 이동 순서">
      <div class="mobile-route-result">
        <div><span>착착 추천</span><strong>${recommendedKtx.service}</strong><small>지금 상황과 이동 조건을 함께 살펴봤어요</small></div>
        <span class="mobile-route-confidence tone-${riskTone(riskLevel)}"><b>${probability}%</b><small>${riskLabel(riskLevel)}</small></span>
      </div>
      <ol class="mobile-route-line">
        ${steps.map((step, index) => `<li><span class="mobile-route-node"><img src="${step.icon}" alt="" aria-hidden="true" /></span><div><small>${index + 1}. ${step.label}</small><strong>${step.value}</strong><span>${step.note}</span></div></li>`).join("")}
      </ol>
      <div class="mobile-route-buffer"><span>탑승 전 예상 여유시간</span><strong>${bufferMinutes}분</strong></div>
    </div>`;
}


function aiCommandCenter(view, recommended) {
  const prediction = modelPredictionFor(view, view.primary);
  if (!prediction) return "";
  const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
  const p90Time = formatTimeAfterMinutes(scheduledArrival, prediction.platformArrivalMinutes.p90);
  const recommendedArex = view.railPlan.airportRail.find((train) => train.id === recommended.id) || view.activeArex;
  const recommendedKtx = view.railPlan.trains.find((train) => train.recommendedArexId === recommended.id) || view.activeKtx;
  const previewDelay = Math.max(0, Math.min(90, Number(state.previewDelayMinutes) || 0));
  const delayProgress = Math.round(previewDelay / 90 * 100);
  const bufferMinutes = Math.round(recommended.bufferMinutes.p90);
  const scene = journeySceneForDestination(state.journey.destination);
  const sceneTone = state.scenarioId === "peak" ? "peak" : previewDelay >= 30 ? "rain" : "normal";
  const sceneStatus = view.isRecovered
    ? "대체 일정 후보를 저장했어요"
    : view.canRecover
      ? "더 여유 있는 열차를 찾았어요"
      : "여유 있게 갈 수 있어요";
  const scenarioHint = state.scenarioId === "peak"
    ? `붐비는 입국장${previewDelay ? `과 ${previewDelay}분 지연` : ""}을 반영했어요`
    : previewDelay > 0
      ? `비행기 ${previewDelay}분 지연을 반영했어요`
      : "지금 도착 상황을 반영했어요";
  const stages = [
    { className: "stage-origin", icon: ICONS.stageOrigin, label: `${escapeHtml(view.signals?.origin || demoTrip.flight.originCity)} 출발`, value: formatTimeAfterMinutes(scheduledArrival, -155) },
    { className: "stage-airport", icon: ICONS.stageAirport, label: "인천공항 도착", value: formatTime(scheduledArrival) },
    { className: "stage-arex", icon: ICONS.stageArex, label: "공항철도", value: formatTime(recommendedArex.departure) },
    { className: "stage-seoul", icon: ICONS.stageSeoul, label: "서울역 도착", value: formatTime(recommendedArex.arrival) },
    { className: "stage-ktx", icon: ICONS.stageKtx, label: recommendedKtx.service, value: formatTime(recommendedKtx.departure) },
    { className: "stage-destination", icon: ICONS.stageDestination, label: `${escapeHtml(state.journey.destination)} 도착`, value: formatTime(recommendedKtx.arrival) }
  ];
  const primaryAction = view.canRecover && !view.isRecovered
    ? `<button class="button button-primary visual-primary-action" data-open-recovery type="button">대체편·표 보호 순서 확인</button>`
    : `<button class="button button-primary visual-primary-action" type="button" data-view-target="travel">${view.isRecovered ? "대체 여행 일정 보기" : "이 일정으로 이어가기"}</button>`;

  return `
    <section class="visual-journey-stage scene-${sceneTone}" aria-labelledby="visual-journey-title">
      <span class="sr-only" id="visual-journey-title">${scenarioHint}. ${sceneStatus}. ${escapeHtml(scene.label)}</span>
      ${mobileRouteBoard(view, recommended, recommendedArex, recommendedKtx, p90Time, bufferMinutes)}
      <figure class="journey-scene" aria-label="인천공항에서 공항철도와 고속열차를 타고 ${escapeHtml(state.journey.destination)}까지 이어지는 추천 여정">
        <img decoding="async" class="journey-scene-image" src="${scene.src}" alt="" aria-hidden="true" />
        <ol class="journey-scene-labels">
          ${stages.map((stage) => `<li class="${stage.className}"><span><img src="${stage.icon}" alt="" aria-hidden="true" /></span><small>${stage.label}</small><strong>${stage.value}</strong></li>`).join("")}
        </ol>
      </figure>
      <div class="journey-control-deck">
        <div class="journey-control-main">
          <label class="journey-time-control" for="journey-time-scrubber">
            <span class="journey-time-copy"><b>비행기 지연 시간을 선택하세요</b><output id="journey-delay-output" for="journey-time-scrubber">${previewDelayLabel(previewDelay)}</output></span>
            <span class="journey-scrubber-wrap" style="--delay-position:${delayProgress}%">
              <input id="journey-time-scrubber" type="range" min="0" max="90" step="5" value="${previewDelay}" aria-label="비행기 도착 지연 시간" aria-valuetext="${previewDelayLabel(previewDelay)}" />
            </span>
            <small><span>지연 없음</span><span>30분</span><span>60분</span><span>90분</span></small>
          </label>
          <ol class="journey-decision-stops" aria-label="추천 여정 시간표">
            <li><img src="${ICONS.decisionPlatform}" alt="" aria-hidden="true" /><span>타는 곳 도착</span><strong>${p90Time}</strong></li>
            <li><img src="${ICONS.decisionArex}" alt="" aria-hidden="true" /><span>공항철도</span><strong>${formatTime(recommendedArex.departure)}</strong></li>
            <li><img src="${ICONS.decisionKtx}" alt="" aria-hidden="true" /><span>${recommendedKtx.service}</span><strong>${formatTime(recommendedKtx.departure)}</strong></li>
            <li><img src="${ICONS.decisionDestination}" alt="" aria-hidden="true" /><span>${escapeHtml(state.journey.destination)} 도착</span><strong>${formatTime(recommendedKtx.arrival)}</strong></li>
          </ol>
        </div>
        <div class="journey-control-actions">
          <span class="journey-buffer"><strong>${bufferMinutes}분</strong> 예상 여유시간</span>
          ${primaryAction}
          <button class="button button-plain" id="open-route-details" type="button">추천 이유와 다른 열차 보기</button>
        </div>
      </div>
    </section>`;
}


function routesView(view) {
  const recommended = view.isRecovered ? view.activeCandidate : view.canRecover ? view.recovery : view.primary;
  const others = view.simulation.candidates.filter((candidate) => candidate.id !== recommended.id);
  const headingStatus = view.isRecovered ? "대체 일정 후보를 저장했어요" : view.canRecover ? "더 여유 있는 열차를 찾았어요" : "여유 있게 갈 수 있어요";
  return `
    <section class="view-heading routes-visual-heading" aria-labelledby="view-title">
      <div><span class="eyebrow">다음 열차</span><h1 id="view-title" tabindex="-1">탈 수 있는 열차부터 보여드려요</h1><p class="routes-heading-status"><img src="${ICONS.routeHeading}" alt="" aria-hidden="true" />${headingStatus}</p></div>
      <p class="schedule-source">${context.journeyDateLabel}<br />${escapeHtml(view.railPlan.sourceLabel)}</p><div class="routes-scenario-picker"><span>다른 상황도 미리 보세요</span><div class="scenario-bar" aria-label="다른 상황 미리 보기">${scenarioButtons()}</div></div>
    </section>
    ${confirmedJourneyBanner(view, "travel")}
    ${aiCommandCenter(view, recommended)}
    ${ticketProtectionPanel(view)}
    <details class="panel route-details-drawer" id="route-details">
      <summary><span><strong>추천 이유와 다른 열차 보기</strong><small>왜 이 열차인지 확인하고 다른 시간과 비교해 보세요</small></span></summary>
      <div class="route-details-body">
        ${reconciliationPanel(view)}
        ${recommendationDetails(view, recommended)}
        <section class="alternative-routes-section" aria-labelledby="alternative-routes-title">
          <div class="alternative-routes-heading"><div><span>다른 선택</span><h2 id="alternative-routes-title">다른 열차 ${others.length}개도 바로 비교해 보세요</h2></div><p>열차를 펼치면 출발·환승·도착 시간을 더 자세히 볼 수 있어요.</p></div>
          <div class="alternative-route-list">${others.map((candidate, index) => alternativeRouteOption(candidate, view, recommended, index)).join("")}</div>
        </section>
      </div>
    </details>`;
}


return { reconciliationPanel, recommendationDetails, ticketProtectionPanel, ticketProtectionDialog, alternativeRouteOption, routeOption, decisionGraphic, journeySceneForDestination, previewDelayLabel, mobileRouteBoard, aiCommandCenter, routesView };
}
