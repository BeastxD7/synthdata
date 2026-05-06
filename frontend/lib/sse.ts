/**
 * Fetch-based SSE reader. Native EventSource cannot send custom headers,
 * which is why we can't use it directly against the backend's /stream endpoint
 * that expects a Bearer token. This reader handles `event:` + `data:` framing,
 * keepalive `ping` events, and cancellation via AbortController.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export type SSEEventType = "stage" | "progress" | "done" | "error" | "cancelled" | "ping";

export interface SSEEvent {
  type: SSEEventType;
  stage?: string;
  payload?: Record<string, unknown>;
}

export interface SSEHandle {
  close: () => void;
}

export function subscribeToJobEvents(
  jobId: string,
  accessToken: string,
  onEvent: (event: SSEEvent) => void,
  onClose?: (reason?: "done" | "error" | "abort") => void,
): SSEHandle {
  const controller = new AbortController();
  let closed = false;

  const close = (reason?: "done" | "error" | "abort") => {
    if (closed) return;
    closed = true;
    controller.abort();
    onClose?.(reason);
  };

  (async () => {
    try {
      const res = await fetch(`${BASE_URL}/jobs/${jobId}/stream`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        close("error");
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        // Each event is separated by a blank line ("\n\n").
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          let evt = "message";
          let data = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) evt = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (evt === "ping") continue;

          try {
            const payload = data ? (JSON.parse(data) as Record<string, unknown>) : {};
            const stage = typeof payload.stage === "string" ? payload.stage : undefined;
            const evtPayload = (payload.payload as Record<string, unknown>) ?? payload;

            const ev: SSEEvent = { type: evt as SSEEventType, stage, payload: evtPayload };
            onEvent(ev);

            if (evt === "done" || evt === "error" || evt === "cancelled") {
              close(evt === "done" ? "done" : "error");
              return;
            }
          } catch {
            // ignore malformed
          }
        }
      }
      close("done");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      close("error");
    }
  })();

  return { close: () => close("abort") };
}
