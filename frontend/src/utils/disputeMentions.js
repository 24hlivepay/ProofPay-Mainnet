// "@mention" helpers for the dispute conversation: address the buyer, seller
// or admin by name and role. Text only -- nothing is stored beyond the message.

// The three people in a dispute. `insert` is exactly what lands in the box.
export function buildDisputeParties(escrow) {
  const named = (key, role, name) => ({
    key,
    role,
    name: name || "",
    insert: name ? `@${name} (${role})` : `@${role}`,
  });
  return [
    named("buyer", "Buyer", String(escrow?.buyerName || "").trim()),
    named("seller", "Seller", String(escrow?.sellerName || "").trim()),
    { key: "admin", role: "ProofPay admin", name: "", insert: "@ProofPay admin" },
  ];
}

// The "@partial" word ending at the caret, if the caret is in one.
export function findMentionQuery(text, caret) {
  const upto = String(text).slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(upto);
  if (!match) return null;
  const query = match[2];
  return { start: upto.length - query.length - 1, query };
}

// Everyone except the sender, narrowed by what has been typed after "@".
export function filterParties(parties, selfKey, query = "") {
  const needle = query.toLowerCase();
  return parties
    .filter((party) => party.key !== selfKey)
    .filter((party) => !needle || `${party.name} ${party.role}`.toLowerCase().includes(needle));
}

// Replace text[start..caret) (the "@partial") with the full mention.
export function applyMention(text, caret, start, insert) {
  const after = text.slice(caret);
  const spacer = after.startsWith(" ") ? "" : " ";
  const next = `${text.slice(0, start)}${insert}${spacer}${after}`;
  return { text: next, caret: start + insert.length + 1 };
}

// Insert a mention at the caret (used by the quick buttons).
export function insertMentionAtCaret(text, caret, insert) {
  const before = text.slice(0, caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const after = text.slice(caret);
  const spacer = after.startsWith(" ") ? "" : " ";
  const next = `${before}${lead}${insert}${spacer}${after}`;
  return { text: next, caret: before.length + lead.length + insert.length + 1 };
}

// Split a message so the mentions of the three parties can be highlighted.
export function splitMentions(text, parties) {
  const tokens = parties.map((party) => party.insert).sort((a, b) => b.length - a.length);
  if (!text || tokens.length === 0) return [{ text: String(text || ""), mention: false }];
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "g");
  return String(text)
    .split(pattern)
    .filter((piece) => piece !== "")
    .map((piece) => ({
      text: piece,
      mention: tokens.includes(piece),
      key: parties.find((party) => party.insert === piece)?.key,
    }));
}
