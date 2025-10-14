export default function Button({
  icon,
  children,
  onClick,
  className = "",
  type = "button",
  disabled = false,
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`bg-gray-800 text-white rounded-full p-4 flex items-center gap-1 ${
        disabled ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
      } ${className}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
