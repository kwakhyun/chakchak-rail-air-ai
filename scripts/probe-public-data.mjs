import { loadLocalEnv } from "../lib/env.mjs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await loadLocalEnv(root);

const key = process.env.DATA_GO_KR_API_KEY || "";
if (!key) throw new Error("DATA_GO_KR_API_KEY is not configured");

function params(extra) {
  return new URLSearchParams({ serviceKey: key, _type: "json", ...extra });
}

function itemsFrom(payload) {
  const items = payload?.response?.body?.items?.item
    ?? payload?.response?.body?.items
    ?? payload?.body?.items?.item
    ?? payload?.body?.items
    ?? [];
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function summarize(payload) {
  const header = payload?.response?.header ?? payload?.header ?? null;
  const body = payload?.response?.body ?? payload?.body ?? null;
  return {
    topLevelKeys: Object.keys(payload || {}).slice(0, 20),
    responseKeys: Object.keys(payload?.response || {}).slice(0, 20),
    resultCode: header?.resultCode ?? header?.resultCd ?? null,
    resultMsg: header?.resultMsg ?? header?.resultMessage ?? null,
    totalCount: body?.totalCount ?? null,
    itemCount: itemsFrom(payload).length,
    firstItemKeys: Object.keys(itemsFrom(payload)[0] || {}).slice(0, 20),
    safePreview: JSON.stringify(payload)
      .replace(/[A-Za-z0-9%+/_=-]{40,}/g, "[REDACTED]")
      .slice(0, 1200)
  };
}

async function probe(date) {
  const extras = {
    pageNo: "1",
    numOfRows: "20",
    depPlaceId: "NAT010000",
    arrPlaceId: "NAT040257",
    depPlandTime: date,
    trainGradeCode: "00"
  };
  const query = params(extras);
  const response = await fetch(`https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo?${query}`);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      date,
      requestMode: "official-decoding-key-query",
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      parseError: true,
      preview: text.replace(/[A-Za-z0-9%+/_=-]{40,}/g, "[REDACTED]").slice(0, 240)
    };
  }
  return { date, requestMode: "official-decoding-key-query", httpStatus: response.status, ...summarize(payload) };
}

const results = [];
for (const date of ["20260804", "20260805", "20260812"]) {
  results.push(await probe(date));
}

console.log(JSON.stringify({ source: "국토교통부_(TAGO)_열차정보", results }, null, 2));
