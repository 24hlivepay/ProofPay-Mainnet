export default function PrimaryButton({
  children,
  onClick,
  disabled = false,
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-4 rounded-xl font-semibold transition ${
        disabled
          ? "bg-slate-300 text-slate-500 cursor-not-allowed"
          : "bg-blue-600 hover:bg-blue-700 text-white"
      }`}
    >
      {children}
    </button>
  );
}