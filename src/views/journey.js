export function createJourneyViews(context) {
  const { ICONS, aiGuideCard, compactDisclosure, confirmedJourneyBanner, dataModeLabel, demoTrip, displayedProbability, displayedRiskLevel, escapeHtml, formatPercent, formatTime, modelPredictionFor, predictionSourceLabel, probabilitySentence, riskLabel, riskTone, signalModeLabel, state } = context;

function liveSignalBoard(view) {
  const signals = view.signals;
  const example = state.journey.useExampleFlight;
  if (state.fusionLoading && !signals) {
    return `<section class="panel signal-board is-loading" aria-busy="true"><div class="signal-board-head"><div><span class="eyebrow">지금 상황</span><h2>공항과 철도 상황을 연결하고 있어요</h2></div><span class="data-pulse">연결 중</span></div><div class="signal-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div></section>`;
  }

  const modes = signals?.inputModes || {};
  const flightValue = signals
    ? signals.flightDelayMinutes > 0 ? `+${signals.flightDelayMinutes}분` : "정시 예상"
    : "체험";
  const immigrationValue = signals ? `${signals.immigrationTotal.toLocaleString("ko-KR")}명` : "보통";
  const weatherValue = signals ? `${Math.round(signals.precipitationProbability)}%` : "낮음";
  const railValue = signals?.averageRailDelayMinutes === null || signals?.averageRailDelayMinutes === undefined
    ? signals?.railObservationCount ? `${signals.railObservationCount}건` : "시간표"
    : `${signals.averageRailDelayMinutes >= 0 ? "+" : ""}${signals.averageRailDelayMinutes}분`;
  const liveCount = signals?.liveInputCount || 0;

  const cards = example ? [
    { id: "flight", icon: ICONS.signalFlight, label: "항공 도착", value: state.previewDelayMinutes ? `${state.previewDelayMinutes}분 지연 가정` : "정시 가정", note: `도쿄 → 인천 T2 · ${formatTime(state.journey.arrivalAt)} 도착 예시` },
    { id: "immigration", icon: ICONS.signalImmigration, label: "입국장", value: view.preset.immigrationMultiplier > 1 ? "혼잡 가정" : "보통 가정", note: "선택한 입국장 혼잡 조건을 반영해요" },
    { id: "weather", icon: ICONS.signalWeather, label: "공항 날씨", value: "예시 날씨", note: "선택한 날씨 시나리오를 반영해요" },
    { id: "rail", icon: ICONS.signalRail, label: "공항철도", value: "예시 시간표", note: "예시 항공편과 연결되는 시간표예요" }
  ] : [
    { id: "flight", icon: ICONS.signalFlight, label: "항공 도착", value: modes.flight === "example" ? "예시 · 정시" : modes.flight === "live" ? flightValue : "조회 불가", note: modes.flight === "example" ? "도쿄 → 인천 T2 · 예시 도착 시각" : modes.flight === "live" ? `${signals.airline} · ${signals.terminal} · 게이트 ${signals.gate}` : "항공편 정보를 확인하지 못했어요" },
    { id: "immigration", icon: ICONS.signalImmigration, label: "입국장", value: modes.immigration === "live" ? immigrationValue : "조회 불가", note: modes.immigration === "live" ? `가장 붐비는 ${signals.busiestHall.hall} 입국장 ${signals.busiestHall.waiting}명` : "입국장 관측값이 없어 체험 입력을 사용해요" },
    { id: "weather", icon: ICONS.signalWeather, label: "공항 날씨", value: modes.weather === "live" ? weatherValue : "조회 불가", note: modes.weather === "live" ? `강수확률 · 바람 ${Math.round(signals.windSpeedKmh)}km/h` : "해당 시각의 기상 관측을 확인하지 못했어요" },
    { id: "rail", icon: ICONS.signalRail, label: "공항철도", value: railValue, note: signals?.railObservationCount ? `운행 관측 ${signals.railObservationCount}건 · 연결 시간표 별도 확인` : "검증된 시간표 사용" }
  ];

  return `
    <section class="panel signal-board" aria-labelledby="signal-board-title">
      <div class="signal-board-head">
        <div><span class="eyebrow">${example ? "예시 조건" : "지금 상황"}</span><h2 id="signal-board-title">${example ? "예시 여정에 적용한 공항과 철도 조건" : "공항과 철도 상황을 한눈에 확인하세요"}</h2><p>${example ? "체험을 위한 예시 값입니다. 실제 정보는 여행조건 설정에서 조회할 수 있어요." : "항공 도착, 입국장, 날씨와 공항철도 운행을 함께 살펴봅니다."}</p></div>
        ${example ? `<div class="coverage-badge"><strong>예시</strong><span>체험 모드</span></div>` : `<div class="coverage-badge" aria-label="전체 ${signals?.inputSourceCount || 4}개 중 ${liveCount}개 실시간"><strong>${liveCount}/${signals?.inputSourceCount || 4}</strong><span>실시간 신호</span></div>`}
      </div>
      <ol class="signal-network">
        ${cards.map((card) => `
          <li class="signal-node mode-${example ? "example" : escapeHtml(modes[card.id] || "demo")}">
            <div class="signal-icon"><img src="${card.icon}" alt="" aria-hidden="true" /></div>
            <span>${card.label}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.note)}</small>
            <em>${example ? "예시 조건" : signalModeLabel(modes[card.id] || "demo")}</em>
          </li>`).join("")}
      </ol>
      <div class="signal-to-decision"><span>${example ? "예시 조건" : "지금 정보"}</span><i aria-hidden="true"></i><strong>놓칠 가능성 확인</strong><i aria-hidden="true"></i><span>안전한 열차·지역 일정</span></div>
    </section>`;
}


function chakchakModelPanel(view) {
  const prediction = modelPredictionFor(view, view.activeCandidate);
  if (!prediction) return "";
  const shownProbability = displayedProbability(view, view.activeCandidate);
  const shownSafe = view.decisionByTrainId.get(view.activeCandidate.id)?.eligible;
  const oodReasons = view.chakchakAi.decision?.oodReasons || [];
  const waterfall = prediction.probabilityWaterfall;
  const visibleEffects = waterfall.contributions;
  const maxEffect = Math.max(1, ...visibleEffects.map((effect) => Math.abs(effect.effectPercentPoints)));
  return `
    <section class="panel chakchak-model-panel" aria-labelledby="chakchak-model-title">
      <div class="model-panel-head">
        <div><span class="eyebrow">착착 안전 확인</span><h2 id="chakchak-model-title">${view.modelFallbackRequired ? "낯선 상황이라 더 여유 있게 살펴봤어요" : "지금 열차를 탈 수 있을지 살펴봤어요"}</h2><p>항공 도착, 입국장, 날씨, 짐과 걷는 속도를 함께 보고 안내합니다.</p></div>
        <span class="model-version">확인 완료<small>한 번 더 점검</small></span>
      </div>
      ${view.modelFallbackRequired ? `<div class="model-ood-alert" role="status"><strong>더 안전하게 안내해요</strong><span>평소와 다른 상황이라 시간을 넉넉하게 잡았습니다.</span>${oodReasons.length ? `<small>확실하지 않을 때는 빠른 열차보다 여유 있는 열차를 먼저 보여드려요.</small>` : ""}</div>` : ""}
      <div class="model-visual-grid">
        <div class="model-score-card">
          <span>이 열차의 탑승 가능성</span>
          <strong>${formatPercent(shownProbability)}</strong>
          <p>${shownSafe ? "여유 있게 이동할 수 있어요" : "더 여유 있는 열차가 필요해요"}</p>
          <div class="model-validation"><span>항공·공항 상황 <b>반영</b></span><span>짐·이동 도움 <b>반영</b></span></div>
          <em class="model-not-operational">좌석과 운임은 코레일에서 마지막으로 확인해 주세요.</em>
        </div>
        <div class="model-factor-card">
          <div class="model-factor-head"><strong>모델 추정의 변화</strong><span>여러 상황을 비교해 최종 탑승 가능성을 안내합니다</span></div>
          <div class="waterfall-equation" aria-label="평소 ${waterfall.baselinePercent}퍼센트에서 현재 ${waterfall.predictedPercent}퍼센트로 바뀜">
            <span><b>${waterfall.baselinePercent}%</b><small>평소 상황</small></span><i aria-hidden="true">→</i><span><b>${waterfall.predictedPercent}%</b><small>지금 상황</small></span>
          </div>
          <ol class="model-waterfall-list">
            ${visibleEffects.map((effect) => {
              const width = Math.max(3, Math.round(Math.abs(effect.effectPercentPoints) / maxEffect * 50));
              const change = Math.abs(Math.round(effect.effectPercentPoints));
              const changeLabel = change === 0 ? "변화 미미" : effect.effectPercentPoints < 0 ? `${change}%p 낮아짐` : `${change}%p 높아짐`;
              return `<li class="effect-${effect.direction}"><span>${escapeHtml(effect.label)}</span><div class="waterfall-track" aria-hidden="true"><i style="--effect-width:${width}%"></i></div><strong>${changeLabel}</strong></li>`;
            }).join("")}
          </ol>
          <p class="waterfall-proof"><b>쉽게 설명했어요</b><span>항공 지연, 입국장, 날씨, 짐과 이동 속도를 빠짐없이 함께 봤습니다.</span></p>
        </div>
      </div>
      <div class="model-pipeline" aria-label="착착이 안내를 준비하는 순서">
        <span><b>${prediction.inputCoverage.liveRiskSignals}/${prediction.inputCoverage.totalRiskSignals}</b> 지금 정보 반영</span><i aria-hidden="true">→</i>
        <span><b>여러 경우</b> 함께 살펴보기</span><i aria-hidden="true">→</i>
        <span><b>${view.modelFallbackRequired ? "여유 있게" : view.modelEngineAgreement ? "한 번 더" : "더 안전하게"}</b> 마지막 확인</span>
      </div>
      <details class="model-stress-audit"><summary>어떻게 안전을 확인했나요?</summary><p>항공편이 늦거나 입국장이 붐비는 여러 상황을 반복해서 살펴봤습니다. 판단이 어려우면 빠른 열차보다 여유 있는 열차를 먼저 안내합니다.</p></details>
      <p class="model-disclaimer">현재는 시험 운영 중이며 실제 좌석이나 탑승을 보장하지 않습니다.</p>
    </section>`;
}


function routeSteps(view) {
  const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
  const totalDelay = Math.round(view.simulation.assumptions.normalizedScenarios.flightDelayMinutes);
  const arrivalLabel = totalDelay > 0
    ? `${formatTime(scheduledArrival)} 예정 · ${totalDelay}분 지연 반영`
    : `${formatTime(scheduledArrival)} 도착 예정`;
  return `
    <ol class="route-steps" aria-label="인천공항에서 ${escapeHtml(state.journey.destination)}역까지 이동 순서">
      <li class="route-step is-air"><span class="route-code">AIR</span><strong>인천공항 ${escapeHtml(view.signals?.terminal || "T2")}</strong><span>${arrivalLabel}</span></li>
      <li class="route-step is-transfer"><span class="route-code">AREX</span><strong>서울역</strong><span>${formatTime(view.activeArex.arrival)} 도착</span></li>
      <li class="route-step is-rail"><span class="route-code">KTX</span><strong>${escapeHtml(state.journey.destination)}역</strong><span>${formatTime(view.activeKtx.arrival)} 도착</span></li>
    </ol>`;
}


function journeyTimeline(view) {
  const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
  const totalDelay = Math.round(view.simulation.assumptions.normalizedScenarios.flightDelayMinutes);
  const arrivalLabel = totalDelay > 0
    ? `${formatTime(scheduledArrival)} +${totalDelay}분`
    : formatTime(scheduledArrival);
  const items = [
    ["항공 도착", arrivalLabel, "is-done"],
    ["입국·짐 찾기", `여유 있게 잡으면 ${formatTime(view.simulation.platformArrival.p90)}`, view.isDisrupted ? "is-risk" : "is-current"],
    ["공항철도", `${formatTime(view.activeArex.departure)} 출발`, ""],
    ["KTX 환승", `${formatTime(view.activeKtx.departure)} 출발`, ""],
    [`${state.journey.destination} 도착`, formatTime(view.activeKtx.arrival), ""]
  ];
  return `
    <ol class="timeline" aria-label="선택한 날짜의 이동 단계">
      ${items.map((item, index) => `
        <li class="timeline-step ${item[2]}">
          <span class="timeline-dot">${index + 1}</span>
          <strong>${item[0]}</strong>
          <span>${item[1]}</span>
        </li>`).join("")}
    </ol>`;
}


function mobileNowCard(view) {
  const probability = Math.round(displayedProbability(view, view.activeCandidate));
  const activeRiskLevel = displayedRiskLevel(view, view.activeCandidate);
  const needsRecovery = view.canRecover && !view.isRecovered;
  const p90 = formatTime(view.simulation.platformArrival.p90);
  const headline = view.isRecovered
    ? `${formatTime(view.activeArex.departure)} 공항철도를 타면 돼요`
    : needsRecovery
      ? "더 여유 있는 열차를 먼저 확인하세요"
      : "공항철도 타는 곳으로 천천히 이동하세요";
  const action = view.isRecovered
    ? `<button class="button button-primary" type="button" data-view-target="travel">대체 여행 일정 보기</button>`
    : needsRecovery
      ? `<button class="button button-primary" type="button" data-open-recovery>표 보호 순서와 대체편 확인</button>`
      : `<button class="button button-primary" type="button" data-view-target="routes">열차 시간 확인</button>`;
  return `
    <section class="mobile-now-card tone-card-${riskTone(activeRiskLevel)}" aria-labelledby="mobile-now-title">
      <div class="mobile-now-copy"><span>지금 할 일</span><h2 id="mobile-now-title">${headline}</h2><p>입국이 늦어지는 경우를 고려하면 타는 곳 도착은 ${p90}쯤으로 예상해요.</p></div>
      <div class="mobile-now-score"><strong>${probability}%</strong><span>${riskLabel(activeRiskLevel)}</span></div>
      ${action}
    </section>`;
}


function journeyView(view) {
  const probability = displayedProbability(view, view.activeCandidate);
  const activeRiskLevel = displayedRiskLevel(view, view.activeCandidate);
  const tone = riskTone(activeRiskLevel);
  const needsRecovery = view.canRecover && !view.isRecovered;
  const nextAction = view.isRecovered
    ? `${formatTime(view.activeArex.departure)} 공항철도를 타면 됩니다.`
    : needsRecovery
      ? "지금 열차는 빠듯합니다. 더 안전한 다음 열차를 확인해 주세요."
      : `${formatTime(view.activeArex.departure)} 공항철도 타는 곳으로 천천히 이동하세요.`;
  const detailCopy = view.isRecovered
    ? `${view.activeKtx.service}를 대체편 후보로 저장했습니다. 탑승 가능성은 ${formatPercent(probability)}입니다.`
    : needsRecovery
      ? `현재 상황과 이동 조건을 반영한 첫 열차의 탑승 가능성은 ${formatPercent(probability)}로 예상됩니다.`
      : `입국이 늦어지는 경우를 고려하면 공항철도 타는 곳 도착은 ${formatTime(view.simulation.platformArrival.p90)}쯤으로 예상해요.`;

  return `
    <section class="view-heading journey-heading" aria-labelledby="view-title">
      <div><span class="eyebrow">${context.journeyDateLabel} 이동</span><h1 id="view-title" tabindex="-1">${escapeHtml(view.signals?.origin || demoTrip.flight.originCity)}에서 ${escapeHtml(state.journey.destination)}까지, 한눈에</h1><p>복잡한 시간표 대신 지금 무엇을 하면 되는지 알려드려요.</p><button class="button button-soft journey-edit" id="open-journey-setup" type="button">항공편·여행조건 바꾸기</button></div>
      <div class="journey-heading-visual">
        <span class="data-badge">${dataModeLabel()}</span>
        <img src="/assets/illustrations/rail-air-journey.webp" width="780" height="188" fetchpriority="high" decoding="async" alt="공항에서 공항철도와 고속열차를 타고 목적지까지 이어지는 여정 그림" />
      </div>
    </section>

    ${confirmedJourneyBanner(view, "travel")}
    ${mobileNowCard(view)}
    ${compactDisclosure({
      title: state.journey.useExampleFlight ? "예시 여정의 공항과 철도 조건" : "공항과 철도의 지금 상황",
      description: "항공·입국장·날씨·공항철도",
      badge: state.journey.useExampleFlight ? "예시" : `${view.signals?.liveInputCount || 0}/4`,
      icon: ICONS.journeyLive,
      content: liveSignalBoard(view),
      className: "journey-signal-disclosure"
    })}
    ${compactDisclosure({
      title: "착착이 살펴본 근거",
      description: "예상 도착 시각과 탑승 가능성 확인",
      badge: `${Math.round(displayedProbability(view, view.activeCandidate))}%`,
      icon: ICONS.journeyModel,
      content: chakchakModelPanel(view),
      className: "journey-model-disclosure"
    })}

    <section class="journey-hero">
      <article class="panel trip-card">
        <div class="trip-card-head">
          <div><span class="flight-chip">${escapeHtml(state.journey.flightId)} · ${escapeHtml(view.signals?.origin || demoTrip.flight.originCity)} 출발</span><h2>${context.journeyDateLabel} 이동 일정</h2></div>
          <span class="status-pill status-${tone}">${riskLabel(activeRiskLevel)}</span>
        </div>
        ${routeSteps(view)}
        <div class="trip-details"><span>위탁수하물 ${state.journey.checkedBags}개</span><span>${escapeHtml(state.journey.destination)} ${state.journey.stayNights}박</span><span>${view.activeKtx.service}</span><span>${state.journey.mobility === "standard" ? "보통 걸음" : "이동 지원 반영"}</span></div>
      </article>

      <article class="panel possibility-card" id="journey-status">
        <div class="possibility-top"><span>${predictionSourceLabel(view)} 탑승 가능성</span><span class="status-dot status-${tone}">${riskLabel(activeRiskLevel)}</span></div>
        <div class="possibility-main">
          <div class="confidence-gauge" style="--gauge-value:${probability}%;--gauge-color:var(--${tone === "safe" ? "safe-fg" : tone === "watch" ? "warn-fg" : "danger-fg"})" role="img" aria-label="이 열차를 탈 가능성 ${Math.round(probability)}퍼센트"><strong>${Math.round(probability)}<small>%</small></strong></div>
          <div><h2>${probabilitySentence(probability)}</h2><p>${detailCopy}</p></div>
        </div>
        <div class="next-action"><strong>지금 할 일</strong><span>${nextAction}</span></div>
        <div class="hero-actions">
          ${view.canRecover && !view.isRecovered ? `<button class="button button-primary" data-open-recovery type="button">대체편·표 보호 순서 보기</button>` : `<button class="button button-primary" type="button" data-view-target="routes">다른 열차 보기</button>`}
          <button class="button button-soft" id="run-disruption" type="button">35분 늦어졌을 때 보기</button>
          <button class="button button-plain" id="reset-demo" type="button">처음 상태로</button>
        </div>
      </article>
    </section>

    <section class="journey-detail-grid">
      <article class="panel timeline-card"><div class="panel-header"><div><h2>이동 순서</h2><p>현재 상황부터 ${escapeHtml(state.journey.destination)} 도착까지</p></div><strong class="arrival-time">${formatTime(view.activeKtx.arrival)} 도착</strong></div>${journeyTimeline(view)}</article>
    </section>
    ${aiGuideCard(view)}`;
}


return { liveSignalBoard, chakchakModelPanel, routeSteps, journeyTimeline, mobileNowCard, journeyView };
}
