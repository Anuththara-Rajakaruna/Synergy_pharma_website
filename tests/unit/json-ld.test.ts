import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeJsonLd } from "@/lib/json-ld";

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("serializeJsonLd", () => {
  const hostile = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "QA Lead </script><script>alert(document.cookie)</script>",
    description: `<p>R&D role</p><!-- comment -->${LINE_SEPARATOR}next${PARAGRAPH_SEPARATOR}para`,
    responsibilities: ["</SCRIPT >", "a > b && c < d"],
  };

  it("cannot close the surrounding script element or open HTML comments", () => {
    const json = serializeJsonLd(hostile);
    assert.equal(/<|>|&/.test(json), false, json);
    assert.equal(json.toLowerCase().includes("</script"), false);
    assert.equal(json.includes("<!--"), false);
  });

  it("escapes U+2028 and U+2029 so older JavaScript parsers do not break", () => {
    const json = serializeJsonLd(hostile);
    assert.equal(json.includes(LINE_SEPARATOR), false);
    assert.equal(json.includes(PARAGRAPH_SEPARATOR), false);
    assert.ok(json.includes("\\u2028"));
    assert.ok(json.includes("\\u2029"));
  });

  it("uses JSON unicode escapes that decode to the original data", () => {
    const json = serializeJsonLd(hostile);
    assert.ok(json.includes("\\u003c/script\\u003e"));
    assert.ok(json.includes("\\u0026"));
    assert.deepEqual(JSON.parse(json), hostile);
  });

  it("leaves harmless data unchanged and serializes undefined as null", () => {
    const plain = { name: "Synergy", count: 3, ok: true, list: [1, "two"], nested: { value: null } };
    assert.equal(serializeJsonLd(plain), JSON.stringify(plain));
    assert.equal(serializeJsonLd(undefined), "null");
  });
});
