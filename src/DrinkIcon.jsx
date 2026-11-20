const marks = {
  mode: (
    <>
      <path
        className="drink-icon-gold"
        d="m4.5 7 6.6 3-3.3 8.6a2 2 0 0 1-2.7 1.1l-1.7-.8a2 2 0 0 1-1.1-2.3z"
      />
      <path
        className="drink-icon-cranberry"
        d="m19.5 7-6.6 3 3.3 8.6a2 2 0 0 0 2.7 1.1l1.7-.8a2 2 0 0 0 1.1-2.3z"
      />
      <path d="m3.3 13 5.4 2.5m6.6 0 5.4-2.5" />
      <path d="M12 2.5v3m-4-1.7 1.3 1.5m6.7-1.5-1.3 1.5" />
    </>
  ),
  credit: (
    <>
      <path
        className="drink-icon-cranberry"
        d="M2.5 6.5V16c0 1.9 3.1 3.5 7 3.5s7-1.6 7-3.5V6.5z"
      />
      <path d="M2.5 11.3c0 1.9 3.1 3.5 7 3.5 1.7 0 3.3-.3 4.5-.8" />
      <ellipse className="drink-icon-gold" cx="9.5" cy="6.5" rx="7" ry="3.5" />
      <path d="M8 6.5h3" />
      <circle className="drink-icon-gold" cx="17.7" cy="16.4" r="4.6" />
      <path d="M17.7 14.4v4m-2-2h4" />
    </>
  ),
  verify: (
    <>
      <path
        className="drink-icon-gold"
        d="M12 3a19 19 0 0 0 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6a19 19 0 0 0 8-3Z"
      />
      <path d="m8.5 12 2.4 2.4 4.6-4.6" />
    </>
  ),
  offer: (
    <>
      <path
        className="drink-icon-gold"
        d="M3 7h11l-1.4 12a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2z"
      />
      <path
        className="drink-icon-cranberry"
        d="M3.7 13h9.6l-.7 6a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2z"
      />
      <path d="m16.5 10 5-5m-4 0h4v4" />
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
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {marks[name]}
    </svg>
  );
}
