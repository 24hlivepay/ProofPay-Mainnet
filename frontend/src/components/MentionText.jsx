import { splitMentions } from "../utils/disputeMentions";

// Buyer green, seller red, ProofPay admin purple (full class names, so Tailwind
// keeps them).
const MENTION_STYLE = {
  buyer: "font-semibold text-green-700",
  seller: "font-semibold text-red-700",
  admin: "font-semibold text-purple-700",
};

// Text with the @mentions of the buyer, seller and admin shown in bold, each in
// its own colour. Plain text otherwise; the caller supplies the surrounding element.
export default function MentionText({ text, parties }) {
  return splitMentions(text, parties || []).map((piece, index) =>
    piece.mention
      ? <span key={index} className={MENTION_STYLE[piece.key] || "font-semibold text-blue-700"}>{piece.text}</span>
      : piece.text
  );
}
