// Minimal server-sent events reader: hands over the `data` of each event as a
// string, for reading the /chat/stream response. Network chunks do not line
// up with events, so partial input is held until the blank line that ends the
// event arrives.
//
// src/sse.js is the backend's copy of this parser. The backend is CommonJS,
// which the frontend cannot import, so the two are kept in step by hand, with
// the same tests.

export function createSseParser(onData) {
  let buffer = "";

  function dispatch(block) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (data.length) onData(data.join("\n"));
  }

  return {
    push(text) {
      // Normalised over the whole buffer, not just the new text, because a
      // CRLF pair can be split across two chunks.
      buffer = (buffer + text).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    end() {
      if (buffer.trim()) dispatch(buffer);
      buffer = "";
    },
  };
}
