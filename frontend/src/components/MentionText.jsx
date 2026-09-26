import { splitMentions } from "../utils/disputeMentions";

// Text with the @mentions of the buyer, seller and admin shown in bold blue.
// Plain text otherwise; the caller supplies the surrounding element.
export default function MentionText({ text, parties }) {
  return splitMentions(text, parties || []).map((piece, index) =>
    piece.mention
      ? <span key={index} className="font-semibold text-blue-700">{piece.text}</span>
      : piece.text
  );
}
