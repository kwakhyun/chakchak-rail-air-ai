const DEFAULT_MAX_JSON_BYTES = 32_768;

export const PUBLIC_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests"
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

export async function readJsonBodyLimited(request, limitBytes = DEFAULT_MAX_JSON_BYTES) {
  const mediaType = String(request.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw httpError("UNSUPPORTED_MEDIA_TYPE", 415);
  }

  const declaredLength = Number(request.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw httpError("PAYLOAD_TOO_LARGE", 413);
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limitBytes) {
        await reader.cancel("PAYLOAD_TOO_LARGE");
        throw httpError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!chunks.length) return {};
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw httpError("INVALID_JSON", 400);
  }
}

export function createFixedWindowRateLimiter({ limit, windowMs, maxEntries = 5_000 }) {
  const buckets = new Map();

  return {
    take(key, now = Date.now()) {
      if (buckets.size >= maxEntries) {
        for (const [bucketKey, bucket] of buckets) {
          if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
        }
      }

      const current = buckets.get(key);
      if (!current && buckets.size >= maxEntries) {
        const earliestReset = Math.min(...Array.from(buckets.values(), (bucket) => bucket.startedAt + windowMs));
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((earliestReset - now) / 1_000)),
          saturated: true
        };
      }
      if (!current || now - current.startedAt >= windowMs) {
        buckets.set(key, { startedAt: now, count: 1 });
        return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
      }

      current.count += 1;
      const allowed = current.count <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - current.count),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000))
      };
    },
    size() {
      return buckets.size;
    }
  };
}

export function applySecurityHeaders(headers) {
  const secured = new Headers(headers);
  for (const [name, value] of Object.entries(PUBLIC_SECURITY_HEADERS)) secured.set(name, value);
  return secured;
}

export function withSecurityHeaders(response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: applySecurityHeaders(response.headers)
  });
}

export function defaultTargetDateTime(now = new Date()) {
  const koreanTime = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  return `${koreanTime.toISOString().slice(0, 19)}+09:00`;
}
