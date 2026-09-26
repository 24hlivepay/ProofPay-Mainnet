import { useState } from "react";
import DealDocuments from "./DealDocuments";

// A compact "agreement & proof" entry for an order record in a list (pending, active,
// completed, cancelled). Both parties' files for that deal show inside the record.
// Nothing is loaded until it is opened, so a long list does not fire one request per card.
export default function OrderDocuments({ escrowId }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="text-sm font-semibold text-blue-700 underline">
        {open ? "Hide agreement & proof" : "View agreement & proof"}
      </button>
      {open && (
        <div className="mt-2">
          <DealDocuments escrowId={escrowId} readOnly />
        </div>
      )}
    </div>
  );
}
