// Serializes structured data for a <script type="application/ld+json"> block.
//
// JSON.stringify leaves "<", ">" and "&" untouched, so text such as "</script>" in a job
// description would close the script element and inject markup. U+2028/U+2029 are escaped as
// well because they terminate lines in older JavaScript parsers. The escapes are valid JSON, so
// consumers read back exactly the original strings.
const UNSAFE_CHARACTERS = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");

function escapeCharacter(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

export function serializeJsonLd(data: unknown): string {
  const json = JSON.stringify(data) ?? "null";
  return json.replace(UNSAFE_CHARACTERS, escapeCharacter);
}
