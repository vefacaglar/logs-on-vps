import { describe, it, expect } from "vitest";
import { parseJSONLines, streamJSONLines, fieldsOf } from "./api";
describe("engine response handling", () => {
  it("reads CRLF, blank lines and aggregation rows without inventing log fields", () => {
    expect(
      parseJSONLines('\r\n{"compose_service":"api","count":"125"}\r\n\n'),
    ).toEqual([{ compose_service: "api", count: "125" }]);
    expect(fieldsOf([{ count: "125", compose_service: "api" }])).toEqual([
      "compose_service",
      "count",
    ]);
  });
  it("rejects non-record results instead of rendering broken rows", () => {
    for (const value of ["null", "[]", "42", '{"_msg":'])
      expect(() => parseJSONLines(value)).toThrow();
  });
  it("decodes UTF-8 and JSON split across network chunks, including the final unterminated line", async () => {
    const bytes = new TextEncoder().encode(
      '{"_msg":"Çağlar"}\n{"_msg":"İstanbul"}',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    const rows = [];
    for await (const row of streamJSONLines(
      stream,
      new AbortController().signal,
    ))
      rows.push(row);
    expect(rows).toEqual([{ _msg: "Çağlar" }, { _msg: "İstanbul" }]);
  });
  it("does not deliver buffered rows after the user stops a live stream", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"id":1}\n{"id":2}\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const reader = streamJSONLines(stream, controller.signal);
    expect((await reader.next()).value).toEqual({ id: 1 });
    controller.abort();
    expect((await reader.next()).done).toBe(true);
    expect(cancelled).toBe(true);
  });
});
