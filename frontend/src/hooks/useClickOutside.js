import { useEffect, useRef } from "react";

// Closes an open dropdown/menu when the user clicks anywhere outside the
// given element — without changing whatever option they had selected.
export function useClickOutside(isOpen, onClose) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onClose]);

  return ref;
}
