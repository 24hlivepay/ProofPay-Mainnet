export default function StatusBadge({ status }) {

  const colors = {
    pending: "bg-yellow-100 text-yellow-700",
    active: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    dispute: "bg-red-100 text-red-700",
  }

  return (
    <span
      className={`px-4 py-2 rounded-full text-sm font-semibold ${colors[status]}`}
    >
      {status}
    </span>
  )
}