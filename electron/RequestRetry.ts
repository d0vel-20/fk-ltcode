function canceled(): Error {
  const error = new Error("Request canceled.")
  error.name = "AbortError"
  return error
}

export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(canceled()); return }
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(canceled()) }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve() }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function retryTransientRequest<T>(
  request: () => Promise<T>,
  options: {
    signal?: AbortSignal
    onRetry?: (attempt: number, delayMs: number) => void
    wait?: typeof waitForRetry
    random?: () => number
    maxAttempts?: number
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4
  for (let attempt = 1; ; attempt++) {
    if (options.signal?.aborted) throw canceled()
    try { return await request() }
    catch (error: any) {
      if (options.signal?.aborted || error?.name === "AbortError" || error?.code === "ERR_CANCELED") throw canceled()
      const status = error?.response?.status ?? error?.status
      const transient = [408, 429, 500, 502, 503, 504].includes(status) ||
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNABORTED", "ERR_NETWORK"].includes(error?.code)
      if (!transient || attempt >= maxAttempts) throw error
      const retryAfter = error?.response?.headers?.["retry-after"]
      const retryAfterMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(String(retryAfter)) - Date.now()) : 0
      const backoff = 1000 * 2 ** (attempt - 1) + Math.floor((options.random ?? Math.random)() * 500)
      const delayMs = Math.min(30000, Math.max(backoff, Number.isFinite(retryAfterMs) ? retryAfterMs : 0))
      options.onRetry?.(attempt + 1, delayMs)
      await (options.wait ?? waitForRetry)(delayMs, options.signal)
    }
  }
}

// Return messages without serializing Axios request config, headers, or API keys.
export function requestErrorMessage(error: unknown, provider = "AI provider"): string {
  const value = error as { response?: { status?: number }; status?: number; code?: string; name?: string; message?: string }
  const status = value?.response?.status ?? value?.status
  if (value?.name === "AbortError" || value?.code === "ERR_CANCELED") return "Request canceled."
  if (status === 503 || status === 502 || status === 504 || status === 500) return `${provider} is temporarily unavailable after several attempts. Your question was kept; try again shortly.`
  if (status === 429) return `${provider} rate limit or quota exceeded. Wait a moment or check your API usage, then retry.`
  if (status === 401 || status === 403) return `${provider} rejected the API key or access permission. Check your key in Settings.`
  if (status === 404) return `${provider} could not find the selected model. Choose another model in Settings.`
  if (status === 400) return `${provider} could not accept the request. Check your question and model settings.`
  if (["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNABORTED", "ERR_NETWORK"].includes(value?.code || "")) return `Could not reach ${provider}. Check your connection and retry.`
  if (status) return `${provider} request failed (HTTP ${status}). Please retry.`
  return (value?.message || "Failed to answer question.")
    .replace(/([?&]key=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(x-goog-api-key[\s'":=]+)[^\s'",}]+/gi, "$1[redacted]")
}
