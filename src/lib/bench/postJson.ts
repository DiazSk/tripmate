import { request } from "node:http";

/**
 * POST JSON without undici. Node's `fetch` gives up at a 300s `headersTimeout` that no fetch
 * option exposes, and the legacy route routinely answers after 300s (417s on 2026-09-25).
 * `node:http` has no such ceiling; its socket timeout is set to the caller's.
 */
export function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: timeoutMs },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        // A socket dropped after the headers never reaches "end": without these the promise never
        // settles and a two-hour sweep stalls on one run instead of recording it as failed.
        res.on("error", reject);
        res.on("close", () => {
          if (!res.complete) reject(new Error("connection closed mid-response"));
        });
        res.on("end", () => {
          let payload;
          try {
            payload = JSON.parse(text);
          } catch {
            payload = { raw: text.slice(0, 300) };
          }
          resolve({ status: res.statusCode ?? 0, payload });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`no answer after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(data);
  });
}
