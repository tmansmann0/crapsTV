const marks = {
  mode: (
    <>
      <path d="m4.5 6 6.5 3-3.2 8.6a2 2 0 0 1-2.7 1.1l-1.7-.8a2 2 0 0 1-1.1-2.3z" />
      <path d="m19.5 6-6.5 3 3.2 8.6a2 2 0 0 0 2.7 1.1l1.7-.8a2 2 0 0 0 1.1-2.3z" />
      <path d="m3.5 11.5 5.5 2.6m6 0 5.5-2.6" />
      <path className="drink-icon-accent" d="M12 3v3" />
    </>
  ),
  credit: (
    <>
      <ellipse cx="9" cy="6" rx="6" ry="3" />
      <path d="M3 6v5c0 1.7 2.7 3 6 3 .7 0 1.4-.1 2-.2M15 6v4M3 11v5c0 1.7 2.7 3 6 3 .7 0 1.4-.1 2-.2" />
      <path className="drink-icon-accent" d="M18 12v8m-4-4h8" />
    </>
  ),
  verify: (
    <>
      <path d="M12 3a19 19 0 0 0 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6a19 19 0 0 0 8-3Z" />
      <path className="drink-icon-accent" d="m9 12 2 2 4-4" />
    </>
  ),
  offer: (
    <>
      <path d="M3 6h10l-1.4 12a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2zM4 12h8" />
      <path className="drink-icon-accent" d="m16 12 5-5m-5 0h5v5" />
    </>
  ),
};

export default function DrinkIcon({ name, size = 24 }) {
  return (
    <svg
      className="drink-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {marks[name]}
    </svg>
  );
}
