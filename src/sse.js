// Minimal server-sent events reader: hands over the `data` of each event as a
// string. Gemini streams its answer in this format, and so does /chat/stream.
// Network chunks do not line up with events, so partial input is held until
// the blank line that ends the event arrives.
//
// frontend/src/sse.js is the same parser as an ES module; the backend is
// CommonJS and the frontend cannot import it.

function createSseParser(onData) {
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

module.exports = { createSseParser };
