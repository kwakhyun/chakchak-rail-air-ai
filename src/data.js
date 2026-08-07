export const demoTrip = Object.freeze({
  id: "DEMO-ICN-JEONJU-0812",
  mode: "demo",
  traveller: {
    name: "Mina",
    locale: "ko-KR",
    passengerType: "international",
    checkedBags: 1,
    mobility: "standard",
    pace: "standard",
    interests: ["로컬 음식", "전통문화", "야간 산책"]
  },
  flight: {
    flightId: "KE704",
    originCode: "NRT",
    originCity: "도쿄",
    airportCode: "ICN",
    terminal: "T2",
    gate: "233",
    carousel: "8",
    scheduledArrival: "2026-08-12T17:05:00+09:00",
    estimatedArrival: "2026-08-12T17:05:00+09:00",
    status: "정시",
    dataLabel: "시드 시나리오"
  },
  destination: {
    city: "전주",
    station: "전주역",
    stayNights: 2
  },
  airport: {
    immigrationLoad: 0.44,
    weatherSeverity: 0.12,
    terminalWalkMinutes: 12,
    arexBoardingBufferMinutes: 5
  },
  rail: {
    transferStation: "서울역",
    airportRail: [
      {
        id: "AREX-1848",
        service: "공항철도 직통",
        departure: "2026-08-12T18:48:00+09:00",
        arrival: "2026-08-12T19:39:00+09:00",
        platform: "B7"
      },
      {
        id: "AREX-1948",
        service: "공항철도 직통",
        departure: "2026-08-12T19:48:00+09:00",
        arrival: "2026-08-12T20:39:00+09:00",
        platform: "B7"
      },
      {
        id: "AREX-2048",
        service: "공항철도 직통",
        departure: "2026-08-12T20:48:00+09:00",
        arrival: "2026-08-12T21:39:00+09:00",
        platform: "B7"
      },
      {
        id: "AREX-2118",
        service: "공항철도 직통",
        departure: "2026-08-12T21:18:00+09:00",
        arrival: "2026-08-12T22:09:00+09:00",
        platform: "B7"
      }
    ],
    trains: [
      {
        id: "KTX-419",
        service: "KTX 419",
        origin: "서울역",
        destination: "전주역",
        departure: "2026-08-12T20:12:00+09:00",
        arrival: "2026-08-12T21:54:00+09:00",
        platform: "8",
        price: 34600,
        transferMinutes: 18,
        recommendedArexId: "AREX-1848"
      },
      {
        id: "KTX-421",
        service: "KTX 421",
        origin: "서울역",
        destination: "전주역",
        departure: "2026-08-12T21:12:00+09:00",
        arrival: "2026-08-12T22:54:00+09:00",
        platform: "7",
        price: 34600,
        transferMinutes: 18,
        recommendedArexId: "AREX-1948"
      },
      {
        id: "KTX-423",
        service: "KTX 423",
        origin: "서울역",
        destination: "전주역",
        departure: "2026-08-12T22:12:00+09:00",
        arrival: "2026-08-12T23:54:00+09:00",
        platform: "9",
        price: 34600,
        transferMinutes: 18,
        recommendedArexId: "AREX-2048"
      },
      {
        id: "KTX-425",
        service: "KTX 425",
        origin: "서울역",
        destination: "전주역",
        departure: "2026-08-12T22:42:00+09:00",
        arrival: "2026-08-13T00:21:00+09:00",
        platform: "7",
        price: 34600,
        transferMinutes: 18,
        recommendedArexId: "AREX-2118"
      }
    ]
  }
});

export const disruptionPresets = Object.freeze({
  normal: {
    id: "normal",
    label: "현재 운항",
    shortLabel: "정상",
    flightDelayMinutes: 0,
    weatherSeverity: 0.12,
    immigrationMultiplier: 1,
    baggageDelayMinutes: 0,
    note: "항공편 정시 · 입국장 보통"
  },
  rain: {
    id: "rain",
    label: "폭우 지연",
    shortLabel: "+35분",
    flightDelayMinutes: 35,
    weatherSeverity: 0.82,
    immigrationMultiplier: 1.38,
    baggageDelayMinutes: 9,
    note: "기상 악화 · 도착 +35분 · 입국장 혼잡"
  },
  peak: {
    id: "peak",
    label: "입국 피크",
    shortLabel: "혼잡",
    flightDelayMinutes: 8,
    weatherSeverity: 0.2,
    immigrationMultiplier: 1.82,
    baggageDelayMinutes: 5,
    note: "동시간대 도착편 집중 · 외국인 심사대 혼잡"
  }
});

export const tourismPlan = Object.freeze({
  original: [
    { time: "22:20", title: "남부시장 야시장", detail: "도착 후 35분 체류", type: "food", status: "tight" },
    { time: "09:00", title: "경기전 고요한 산책", detail: "혼잡 전 입장", type: "culture", status: "good" },
    { time: "11:10", title: "한옥마을 공방", detail: "한지 만들기 예약", type: "experience", status: "good" }
  ],
  recovered: [
    { time: "+1 00:40", title: "체크인 · 늦은 도착 안심 동선", detail: "24시 운영 식사·숙소 동선으로 교체", type: "stay", status: "good" },
    { time: "08:40", title: "남부시장 아침 미식", detail: "야시장 대신 현지인 아침 코스", type: "food", status: "good" },
    { time: "10:10", title: "경기전 · 한옥마을", detail: "공방 예약 60분 순연", type: "culture", status: "good" }
  ]
});

export const sourceCatalog = Object.freeze([
  {
    owner: "인천국제공항공사",
    name: "여객편 운항현황",
    fields: "예정·변경시각, 터미널, 게이트, 수하물, 운항상태",
    cadence: "실시간",
    mode: "adapter"
  },
  {
    owner: "인천국제공항공사",
    name: "입국장 현황",
    fields: "도착편, 실제 도착, 입국장, 내·외국인 대기인원",
    cadence: "실시간",
    mode: "adapter"
  },
  {
    owner: "한국철도공사",
    name: "열차운행정보",
    fields: "열차운행계획, 역사 도착·출발, 실제 운행",
    cadence: "운행 기준",
    mode: "adapter"
  },
  {
    owner: "한국관광공사",
    name: "TourAPI 4.0",
    fields: "관광지, 행사, 운영시간, 위치, 다국어 콘텐츠",
    cadence: "주기 갱신",
    mode: "adapter"
  }
]);

export const impactMetrics = Object.freeze([
  { value: "17분", label: "평균 불필요 대기 감소", footnote: "시뮬레이션 가설" },
  { value: "23%p", label: "추천 환승 성공률 개선", footnote: "위험 경로 대비" },
  { value: "10초", label: "지연 감지 후 대안 제시", footnote: "서비스 목표" },
  { value: "1회", label: "Air·Rail·관광 통합 재계획", footnote: "끊김 없는 경험" }
]);
