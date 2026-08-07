export const RAIL_SNAPSHOT = Object.freeze({
  id: "seoul-jeonju-demo-2026-08-12",
  route: Object.freeze({ departure: "서울", arrival: "전주" }),
  serviceDate: "2026-08-12",
  capturedAt: "2026-08-04T00:00:00+09:00",
  sourceType: "presentation-reference",
  authoritative: false,
  notice: "시연용 기준 시간표입니다. 실제 운행·좌석·운임은 코레일 공식 채널에서 확인해야 합니다.",
  rows: Object.freeze([
    Object.freeze({ trainNo: "419", service: "KTX 419", departureStation: "서울", arrivalStation: "전주", departureTime: "20260812201200", arrivalTime: "20260812215400", adultFare: 34600 }),
    Object.freeze({ trainNo: "421", service: "KTX 421", departureStation: "서울", arrivalStation: "전주", departureTime: "20260812211200", arrivalTime: "20260812225400", adultFare: 34600 }),
    Object.freeze({ trainNo: "423", service: "KTX 423", departureStation: "서울", arrivalStation: "전주", departureTime: "20260812221200", arrivalTime: "20260812235400", adultFare: 34600 }),
    Object.freeze({ trainNo: "425", service: "KTX 425", departureStation: "서울", arrivalStation: "전주", departureTime: "20260812224200", arrivalTime: "20260813002100", adultFare: 34600 })
  ])
});

export function snapshotRailData() {
  return RAIL_SNAPSHOT.rows.map((row) => ({ ...row }));
}

export function snapshotRailMetadata() {
  return {
    id: RAIL_SNAPSHOT.id,
    route: { ...RAIL_SNAPSHOT.route },
    serviceDate: RAIL_SNAPSHOT.serviceDate,
    capturedAt: RAIL_SNAPSHOT.capturedAt,
    sourceType: RAIL_SNAPSHOT.sourceType,
    authoritative: RAIL_SNAPSHOT.authoritative,
    notice: RAIL_SNAPSHOT.notice
  };
}
