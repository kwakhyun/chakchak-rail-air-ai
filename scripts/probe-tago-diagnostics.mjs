import { loadLocalEnv } from "../lib/env.mjs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await loadLocalEnv(root);

const serviceKey = process.env.DATA_GO_KR_API_KEY || "";
if (!serviceKey) throw new Error("DATA_GO_KR_API_KEY is not configured");

function safeMessage(value) {
  return String(value || "")
    .replace(/[A-Za-z0-9%+/_=-]{40,}/g, "[REDACTED]")
    .slice(0, 180);
}

function parsePayload(text) {
  try {
    const payload = JSON.parse(text);
    const header = payload?.response?.header || payload?.header || payload?.OpenAPI_ServiceResponse?.cmmMsgHeader || {};
    const body = payload?.response?.body || payload?.body || {};
    return {
      format: "json",
      resultCode: header.resultCode ?? header.returnReasonCode ?? null,
      resultMsg: safeMessage(header.resultMsg ?? header.errMsg ?? header.returnAuthMsg),
      totalCount: body.totalCount ?? null
    };
  } catch {
    const resultCode = text.match(/<resultCode>([^<]+)<\/resultCode>/i)?.[1]
      || text.match(/<returnReasonCode>([^<]+)<\/returnReasonCode>/i)?.[1]
      || null;
    const resultMsg = text.match(/<resultMsg>([^<]+)<\/resultMsg>/i)?.[1]
      || text.match(/<errMsg>([^<]+)<\/errMsg>/i)?.[1]
      || text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/i)?.[1]
      || "";
    return {
      format: "xml-or-text",
      resultCode,
      resultMsg: safeMessage(resultMsg || text.slice(0, 180)),
      totalCount: text.match(/<totalCount>([^<]+)<\/totalCount>/i)?.[1] || null
    };
  }
}

async function request(name, baseUrl, path, extra = {}) {
  const params = new URLSearchParams({ serviceKey, _type: "json", ...extra });
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}?${params}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    return {
      name,
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      finalOrigin: new URL(response.url).origin,
      contentType: response.headers.get("content-type"),
      ...parsePayload(text)
    };
  } catch (error) {
    return {
      name,
      elapsedMs: Date.now() - startedAt,
      networkError: safeMessage(error?.message || error?.name)
    };
  }
}

const currentBase = "https://apis.data.go.kr/1613000/TrainInfo";
const probes = [
  request("current-train-https", currentBase, "/GetStrtpntAlocFndTrainInfo", {
    pageNo: "1",
    numOfRows: "5",
    depPlaceId: "NAT010000",
    arrPlaceId: "NAT040257",
    depPlandTime: "20260812",
    trainGradeCode: "00"
  }),
  request("current-city-https", currentBase, "/GetCtyCodeList")
];

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  keyShape: {
    configured: true,
    length: serviceKey.length,
    decodingKey: serviceKey.includes("+") || serviceKey.includes("/")
  },
  results: await Promise.all(probes)
}, null, 2));
