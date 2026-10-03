const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanLessonTitle, cleanModuleName, pointIdFor } = require("./ingest");

test("cleanLessonTitle strips numbers, suffix codes and fixes acronyms", () => {
  assert.equal(cleanLessonTitle("01_what-is-mobile-development_epm"), "What Is Mobile Development");
  assert.equal(cleanLessonTitle("2.expo-secure-store_epm"), "Expo Secure Store");
});

test("cleanModuleName normalises the module prefix", () => {
  assert.equal(cleanModuleName("module 13"), "Module 13");
});

test("pointIdFor is stable and unique per chunk start", () => {
  const a = { module: "Module 1", lessonFolder: "l1", start: 12.5 };
  const b = { ...a, start: 13.5 };
  assert.equal(pointIdFor(a), pointIdFor({ ...a }));
  assert.notEqual(pointIdFor(a), pointIdFor(b));
  assert.match(pointIdFor(a), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
