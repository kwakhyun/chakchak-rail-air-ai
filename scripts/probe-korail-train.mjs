import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "../lib/env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
await loadLocalEnv(root);

const serviceKey = process.env.DATA_GO_KR_API_KEY || "";
if (!serviceKey) throw new Error("DATA_GO_KR_API_KEY is not configured");

const targetDate = process.argv[2] || "20260812";
if (!/^\d{8}$/.test(targetDate)) throw new Error("Date must use YYYYMMDD");
const includeRouteFilter = !process.argv.includes("--all");

const params = new URLSearchParams({
  serviceKey,
  pageNo: "1",
  numOfRows: "100",
  returnType: "JSON",
  "cond[run_ymd::GTE]": targetDate,
  "cond[run_ymd::LTE]": targetDate
});

if (includeRouteFilter) {
  params.set("cond[dptre_stn_nm::EQ]", "서울");
  params.set("cond[arvl_stn_nm::EQ]", "전주");
}

const response = await fetch(`https://apis.data.go.kr/B551457/run/v2/travelerTrainRunPlan2?${params}`, {
  headers: { Accept: "application/json" }
});
const text = await response.text();

let payload;
try {
  payload = JSON.parse(text);
} catch {
  payload = null;
}

const header = payload?.response?.header || payload?.header || {};
const items = payload?.response?.body?.items?.item || [];
const rows = Array.isArray(items) ? items : items ? [items] : [];

console.log(JSON.stringify({
  source: "한국철도공사_열차운행정보",
  endpoint: "travelerTrainRunPlan2",
  httpStatus: response.status,
  contentType: response.headers.get("content-type"),
  resultCode: header.resultCode ?? null,
  resultMsg: header.resultMsg ?? null,
  routeFilter: includeRouteFilter ? "서울→전주" : "없음",
  totalCount: payload?.response?.body?.totalCount ?? rows.length,
  sample: rows.slice(0, 3).map((row) => ({
    date: row.run_ymd,
    trainNo: row.trn_no,
    departureStation: row.dptre_stn_nm,
    arrivalStation: row.arvl_stn_nm,
    departureTime: row.trn_plan_dptre_dt,
    arrivalTime: row.trn_plan_arvl_dt
  }))
}, null, 2));
