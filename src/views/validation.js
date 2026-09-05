export function createValidationViews(context) {
  const { ICONS, P2_VALIDATION_PROTOCOL, dataModeLabel, escapeHtml, impactCards, isCompactScreen, sourceItems, state } = context;

function validationView(view) {
  const report = state.validationStatus;
  const pilot = state.pilotStatus;
  const counts = report?.counts || { enrolled: 0, boardingOutcomes: 0, platformArrivals: 0 };
  const evidence = report?.evidence || { id: "COLLECTING", label: "실측 수집 준비", reason: "검증 서버를 확인하고 있습니다." };
  const metrics = report?.metrics;
  const session = state.validationSession?.session;
  const completed = session?.status === "COMPLETE";
  const pilotAccepting = pilot?.phase === "ENROLLING";
  const pilotPhaseLabel = pilot?.phaseLabel || "운영 상태 확인 중";
  const tone = evidence.id === "NEEDS_REVISION" ? "risk" : evidence.id === "OPERATIONAL_CANDIDATE" ? "safe" : "watch";
  const fieldStage = completed ? 4 : session?.platformArrived ? 3 : session ? 2 : 1;
  const resultTarget = P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold;
  const resultProgress = Math.min(resultTarget, counts.boardingOutcomes);
  const participantState = session
    ? completed
      ? "내 기록을 모두 남겼어요"
      : session.platformArrived
        ? "열차 탑승 결과를 기다려요"
        : "승강장에 도착하면 알려주세요"
    : pilotAccepting
      ? "참여코드로 바로 시작할 수 있어요"
      : "참여 접수를 준비하고 있어요";
  const fieldSteps = [
    { label: "출발 전", detail: "안내 저장", icon: ICONS.fieldSave },
    { label: "승강장", detail: "도착 기록", icon: ICONS.fieldPlatform },
    { label: "열차", detail: "탑승 결과", icon: ICONS.fieldTrain },
    { label: "결과 확인", detail: "착착이 비교", icon: ICONS.fieldResults }
  ];
  return `
    <section class="view-heading validation-heading field-visual-heading" aria-labelledby="view-title">
      <div><span class="eyebrow">이동 기록</span><h1 id="view-title" tabindex="-1">실제 이동을 따라 착착의 안내를 확인해요</h1><p>출발 전 한 번, 현장에서 두 번만 알려주면 더 안전한 안내를 만들 수 있어요.</p></div>
      <span class="status-pill status-${pilotAccepting ? "safe" : tone}">${escapeHtml(pilotPhaseLabel)}</span>
    </section>

    <section class="field-visual-hero" aria-labelledby="field-hero-title">
      <div class="field-hero-board">
        <div class="field-hero-copy"><span>${session ? "내 현장 기록" : "참여 방법"}</span><h2 id="field-hero-title">${session ? participantState : "세 번만 알려주면 확인이 끝나요"}</h2><p>출발 전 안내를 저장하고, 승강장 도착과 열차 탑승 결과를 실제 시각으로 남겨요.</p></div>
        <ol class="field-journey-stops" aria-label="실제 이동 확인 순서">
          ${fieldSteps.map((step, index) => `<li class="${fieldStage > index + 1 ? "is-complete" : fieldStage === index + 1 && (session || pilotAccepting) ? "is-current" : ""}"><img src="${step.icon}" alt="" aria-hidden="true" /><span>${step.label}</span><strong>${step.detail}</strong></li>`).join("")}
        </ol>
        <div class="field-privacy-points" aria-label="개인정보 보호 원칙"><span>이름 저장 안 함</span><span>최대 30일 보관</span><span>언제든 삭제</span></div>
      </div>
    </section>

    <section class="field-status-strip" aria-label="이동 기록 현재 상태">
      <div><img src="${ICONS.fieldParticipate}" alt="" aria-hidden="true" /><span>지금 참여</span><strong>${pilotAccepting ? "참여할 수 있어요" : "접수 준비 중이에요"}</strong><small>${pilotAccepting ? `${pilot?.admission?.available || 0}개의 코드를 사용할 수 있어요` : "접수가 열리면 참여코드를 입력해요"}</small></div>
      <div><img src="${ICONS.fieldRecord}" alt="" aria-hidden="true" /><span>내 기록</span><strong>${participantState}</strong><small>${session ? escapeHtml(view.activeKtx.service) : "아직 저장한 이동 기록이 없어요"}</small></div>
      <div><img src="${ICONS.fieldPublished}" alt="" aria-hidden="true" /><span>결과 공개</span><strong>${counts.boardingOutcomes}/${resultTarget}건 확인</strong><small>${report?.realWorldPerformanceAvailable ? "충분한 결과가 모였어요" : "30건 전에는 성능 숫자를 숨겨요"}</small></div>
    </section>

    <section class="field-main-grid">
      <article class="panel field-participation-card validation-participation">
        <div class="field-participation-head"><div><span class="eyebrow">내 이동 알려주기</span><h2>${session ? "지금 이동 순간을 기록해 주세요" : "개인정보 없이 참여할 수 있어요"}</h2><p>이름·연락처·예약번호·항공편 번호는 저장하지 않아요.</p></div>${session ? `<span class="source-mode mode-live">기록 중</span>` : ""}</div>
        ${session ? `
          <div class="validation-session-summary"><span>익명으로 참여 중</span><strong>${escapeHtml(view.activeKtx.service)}</strong><small>${session.status === "COMPLETE" ? "탑승 결과 기록 완료" : session.platformArrived ? "타는 곳 도착 기록 완료" : "출발 전 안내를 저장하고 현장 기록을 기다립니다"}</small>${session.participantMatchCode ? `<div class="pilot-match-code"><span>추가 확인용 익명 코드</span><b>${escapeHtml(session.participantMatchCode)}</b><small>현장 담당자에게 이 코드만 보여주세요. 이름이나 예약번호는 필요하지 않습니다.</small></div>` : ""}</div>
          <div class="validation-event-actions">
            <button class="button button-soft" type="button" data-validation-event="PLATFORM_ARRIVED" ${session.platformArrived || completed || state.validationBusy ? "disabled" : ""}>${session.platformArrived ? "승강장 도착 기록됨" : "지금 승강장에 도착했어요"}</button>
            <button class="button button-primary" type="button" data-validation-event="TRAIN_BOARDED" ${completed || state.validationBusy ? "disabled" : ""}>열차를 탔어요</button>
            <button class="button button-plain" type="button" data-validation-event="TRAIN_MISSED" ${completed || state.validationBusy ? "disabled" : ""}>열차를 놓쳤어요</button>
          </div>
          <p class="validation-clock-note">버튼을 누른 시각을 정확하게 저장합니다. 실제 이동 시간이 되기 전에는 기록할 수 없습니다.</p>
          <button class="validation-withdraw" id="withdraw-validation" type="button" ${state.validationBusy ? "disabled" : ""}>동의 철회하고 이 여정 기록 모두 삭제</button>` : `
          <div class="field-prep-note status-${pilotAccepting ? "safe" : "watch"}"><strong>${pilotAccepting ? "현장에서 받은 코드가 있다면 시작할 수 있어요" : "지금은 참여 접수를 준비하고 있어요"}</strong><span>${pilotAccepting ? "코드는 한 번만 사용할 수 있어요." : "아래 내용을 미리 확인하고, 접수가 열리면 참여코드를 입력해 주세요."}</span></div>
          <label class="pilot-code-field"><span>현장에서 받은 참여코드</span><input id="pilot-code" type="text" inputmode="text" autocomplete="one-time-code" maxlength="14" placeholder="CHAK-XXXX-XXXX" aria-describedby="pilot-code-help" ${pilotAccepting ? "" : "disabled"}/><small id="pilot-code-help">한 번만 사용할 수 있어 체험 기록과 실제 이동을 구분할 수 있어요.</small></label>
          <label class="validation-consent"><input id="validation-consent" type="checkbox" /><span><strong>익명으로 이동 결과를 알려주는 데 동의합니다</strong><small>이동 조건, 안내 결과, 도착 시각과 탑승 결과를 최대 30일 보관합니다. 이름·연락처·예약번호는 저장하지 않으며 언제든 삭제할 수 있습니다.</small></span></label>
          <label class="validation-consent validation-consent-optional"><input id="institution-match-consent" type="checkbox" /><span><strong>기관 자료와 한 번 더 확인하는 데 동의합니다 <em>선택</em></strong><small>선택하면 현장에서 받은 익명 코드로 기관 자료와 맞는지 확인할 수 있습니다. 별도의 협의가 끝난 뒤에만 진행합니다.</small></span></label>
          <button class="button button-primary validation-start" id="start-validation" type="button" ${state.validationBusy || !pilotAccepting ? "disabled" : ""}>${state.validationBusy ? "출발 전 안내를 저장하고 있어요…" : pilotAccepting ? "현재 여정 확인 시작" : "참여 접수 전입니다"}</button>`}
        ${state.validationError ? `<p class="inline-error" role="alert">${escapeHtml(state.validationError)}</p>` : ""}
      </article>

      <aside class="panel field-results-card validation-metrics-card">
        <div class="field-results-heading"><div><span class="eyebrow">정직한 결과 공개</span><h2>${report?.realWorldPerformanceAvailable ? "충분한 이동 결과가 모였어요" : "30건 전에는 정확도 숫자를 숨겨요"}</h2><p>적은 기록으로 좋아졌다고 말하지 않아요.</p></div><span class="status-pill status-${report?.realWorldPerformanceAvailable ? "safe" : "watch"}">${report?.realWorldPerformanceAvailable ? "결과 공개" : "확인 중"}</span></div>
        ${report?.realWorldPerformanceAvailable && metrics && !metrics.suppressed ? `
          <div class="validation-metric-grid">
            <div><strong>${Math.round(metrics.boarding.successRate * 100)}%</strong><span>실제 탑승 성공</span></div>
            <div><strong>${metrics.boarding.fusedBrier.toFixed(3)}</strong><span>탑승 안내 오차</span></div>
            <div><strong>${metrics.platformArrival.p50MaeMinutes.toFixed(1)}분</strong><span>보통 도착 시각 차이</span></div>
            <div><strong>${Math.round(metrics.platformArrival.p90CoverageRate * 100)}%</strong><span>늦은 도착까지 맞춘 비율</span></div>
          </div>` : `
          <div class="field-result-gate"><div><img src="${ICONS.fieldGate}" alt="" aria-hidden="true" /><strong>${resultTarget}</strong><span>건이 모이면 공개</span></div><progress max="${resultTarget}" value="${resultProgress}" aria-label="실제 이동 결과 ${resultTarget}건 중 ${resultProgress}건 확인"></progress><p>현재 ${counts.boardingOutcomes}건을 확인했어요. 결과가 충분해질 때까지 기다립니다.</p></div>`}
        <ul class="field-quality-list"><li><img src="${ICONS.fieldQuality}" alt="" aria-hidden="true" /><span>중복·잘못된 기록</span><strong>${report?.quality?.status === "BLOCKED" ? "점검 필요" : "자동 확인"}</strong></li><li><img src="${ICONS.fieldAccess}" alt="" aria-hidden="true" /><span>이동 도움이 필요한 경우</span><strong>${report?.segments?.accessibility?.completed || 0}건</strong></li><li><img src="${ICONS.fieldDisruption}" alt="" aria-hidden="true" /><span>여러 지연이 겹친 경우</span><strong>${report?.segments?.disrupted?.completed || 0}건</strong></li></ul>
      </aside>
    </section>

    <details class="field-ops-details panel">
      <summary><span><img src="${ICONS.fieldOps}" alt="" aria-hidden="true" />이동 기록 서비스 상태 보기</span><small>개인정보 없이 필요한 개수만 확인해요</small></summary>
      <div class="field-ops-content">
        <div class="pilot-ops-head"><div><span class="eyebrow">서비스 상태</span><h2>이동 기록이 안전하게 작동하는지 살펴봐요</h2></div><span class="source-mode ${pilotAccepting ? "mode-live" : "mode-demo"}">${escapeHtml(pilotPhaseLabel)}</span></div>
        <div class="pilot-ops-metrics"><div><span>사용 가능 코드</span><strong>${pilot?.admission?.available || 0}</strong><small>발급 ${pilot?.admission?.issued || 0}개</small></div><div><span>진행 중 여정</span><strong>${pilot?.operations?.inProgress || 0}</strong><small>등록 ${pilot?.operations?.enrolled || 0}건</small></div><div class="${(pilot?.operations?.overdueOutcomes || 0) > 0 ? "is-alert" : ""}"><span>확인 필요한 결과</span><strong>${pilot?.operations?.overdueOutcomes || 0}</strong><small>출발 72시간 경과</small></div><div><span>추가 확인 동의</span><strong>${pilot?.operations?.institutionMatchEligible || 0}</strong><small>기관 확인 전</small></div></div>
        <ul class="pilot-readiness" aria-label="이동 기록 준비 상태"><li><i class="readiness-${pilot?.readiness?.admissionControl === "PASS" ? "pass" : "wait"}"></i><span>참여코드 통제</span><strong>${pilot?.readiness?.admissionControl === "PASS" ? "준비됨" : "준비 중"}</strong></li><li><i class="readiness-${pilot?.readiness?.consentIntegrity === "PASS" ? "pass" : "block"}"></i><span>동의 내용 확인</span><strong>${pilot?.readiness?.consentIntegrity === "PASS" ? "준비됨" : "확인 필요"}</strong></li><li><i class="readiness-${pilot?.readiness?.outcomeFollowUp === "PASS" ? "pass" : "block"}"></i><span>결과 확인</span><strong>${pilot?.readiness?.outcomeFollowUp === "PASS" ? "정상" : "확인 필요"}</strong></li><li><i class="readiness-wait"></i><span>안전한 저장 공간</span><strong>준비 중</strong></li></ul>
        ${(pilot?.alerts || []).length ? `<div class="pilot-alerts">${pilot.alerts.map((alert) => `<p><strong>${escapeHtml(alert.severity)}</strong>${escapeHtml(alert.message)}</p>`).join("")}</div>` : ""}
      </div>
    </details>

    <section class="field-honesty-strip" aria-labelledby="field-honesty-title">
      <div class="field-honesty-title"><div><span class="eyebrow">정직한 안내</span><h2 id="field-honesty-title">확인한 사실만 말씀드려요</h2></div></div>
      <div><img src="${ICONS.fieldHonest}" alt="" aria-hidden="true" /><p><strong>확인할 수 있어요</strong>열차를 탔는지, 승강장에 몇 시에 도착했는지 확인해요.</p></div>
      <div><img src="${ICONS.fieldPending}" alt="" aria-hidden="true" /><p><strong>아직 말할 수 없어요</strong>성공률이 높아졌다는 말은 충분한 참여와 추가 확인 뒤에만 해요.</p></div>
    </section>`;
}


function aboutView(view) {
  const sourcesOpen = isCompactScreen() ? "" : " open";
  return `
    <section class="view-heading" aria-labelledby="view-title"><div><span class="eyebrow">서비스 안내</span><h1 id="view-title" tabindex="-1">착착은 이렇게 안내해요</h1><p>사용하는 정보와 계산 방법, 제공할 수 있는 기능을 투명하게 알려드립니다.</p></div><span class="data-badge">${dataModeLabel()}</span></section>
    <section class="about-layout">
      <details class="panel sources-panel about-data-disclosure"${sourcesOpen}><summary><span class="about-data-summary"><img src="${ICONS.aboutData}" alt="" aria-hidden="true" /><span><strong>연결된 공공·개방 데이터</strong><small>공식 출처와 현재 연결 상태를 확인하세요</small></span></span><span class="mobile-disclosure-badge"><strong>7개</strong><small>보기</small></span></summary><div class="about-data-content"><div class="panel-header"><div><h2>사용하는 공공·개방 데이터</h2><p>항공·공항·철도·기상·관광 정보를 한 여정으로 연결합니다.</p></div></div><ol class="source-list">${sourceItems()}</ol></div></details>
      <aside class="section-stack">
        <article class="panel plain-language-card"><h2>도착 예상 안내</h2><dl><div><dt>대표 예상 도착 시각</dt><dd>평소에는 이 시각쯤 타는 곳에 도착할 것으로 예상해요.</dd></div><div><dt>입국 지연을 고려한 도착 시각</dt><dd>입국과 수하물이 늦어지는 경우까지 포함한 예상이에요.</dd></div><div><dt>열차를 탈 가능성</dt><dd>현재 상황과 개인 이동 조건을 함께 살펴본 결과예요.</dd></div></dl></article>
        <article class="panel honesty-card"><h2>현재 가능한 것</h2><p>항공·입국·날씨·공항철도 정보를 함께 살펴보고, 다음 열차와 지역 여행 일정을 다시 연결합니다.</p><h3>기관 협업이 필요한 것</h3><p>좌석은 코레일 공식 채널에서 확인합니다. 자동 결제와 표 변경은 아직 제공하지 않습니다.</p></article>
      </aside>
    </section>
    <section class="panel impact-panel"><div class="panel-header"><div><h2>서비스가 지키는 약속</h2><p>누구나 안심하고 사용할 수 있도록 다음 원칙을 모든 안내에 적용합니다.</p></div><span class="status-pill status-safe">안심 기준</span></div><ul class="impact-grid">${impactCards()}</ul><p class="demo-notice">실제 이동 결과가 충분히 모이기 전에는 성능 수치를 공개하지 않으며, 좌석과 승차권은 운영사 공식 채널에서 마지막으로 확인하도록 안내합니다.</p></section>`;
}


return { validationView, aboutView };
}
