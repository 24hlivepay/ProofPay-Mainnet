import { useRef } from "react";
import { filterParties, insertMentionAtCaret } from "../utils/disputeMentions";

// A text box with "Address to:" buttons for the other people in a dispute (the other
// party and the ProofPay admin). A button puts "@Name (Role)" into the text at the
// cursor, the same tags the conversation box uses. Used in the forms that open a
// dispute and that answer one.
export default function MentionTextarea({ value, onChange, parties, selfKey, ...textareaProps }) {
  const ref = useRef(null);
  const others = filterParties(parties, selfKey);

  function insert(party) {
    const caret = ref.current?.selectionStart ?? value.length;
    const next = insertMentionAtCaret(value, caret, party.insert);
    onChange(next.text);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <>
      <textarea ref={ref} value={value} onChange={(event) => onChange(event.target.value)} {...textareaProps} />
      {others.length > 0 && (
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs font-normal">
          <span className="text-slate-500">Address to:</span>
          {others.map((party) => (
            <button
              key={party.key}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(party)}
              className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100"
            >
              {party.insert}
            </button>
          ))}
        </span>
      )}
    </>
  );
}
