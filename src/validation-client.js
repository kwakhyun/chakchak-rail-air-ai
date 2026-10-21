/** Keep the only access token on outages, rate limits and malformed responses. */
export async function refreshValidationSession(stored, fetchImpl = fetch) {
  if (!stored?.token) return { stored, warning: null };
  const warning = "이동 기록을 불러오지 못했습니다. 접근 정보는 보관했으니 잠시 후 다시 확인해 주세요.";
  try {
    const response = await fetchImpl("/api/validation/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: stored.token })
    });
    const payload = await response.json();
    if (response.ok && payload?.session && typeof payload.session === "object" && !Array.isArray(payload.session) && typeof payload.session.status === "string") {
      return { stored: { token: stored.token, session: payload.session }, warning: null };
    }
    const permanent = (response.status === 401 && payload?.code === "INVALID_TOKEN")
      || (response.status === 404 && payload?.code === "SESSION_NOT_FOUND")
      || (response.status === 410 && payload?.code === "SESSION_EXPIRED");
    return permanent ? { stored: null, warning: "이 이동 기록은 만료되었거나 삭제되었습니다." } : { stored, warning };
  } catch {
    return { stored, warning };
  }
}
