/** Decorative, code-native illustration matching the approved home reference. */
export function MeetingCalendar() {
  return (
    <svg
      className="meeting-calendar"
      viewBox="0 0 152 176"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id="calendar-cover"
          x1="36"
          y1="44"
          x2="119"
          y2="76"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#95B4FF" />
          <stop offset="1" stopColor="#BDD0FF" />
        </linearGradient>
        <linearGradient
          id="calendar-paper"
          x1="42"
          y1="78"
          x2="110"
          y2="159"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" stopOpacity=".98" />
          <stop offset="1" stopColor="#F8FBFF" stopOpacity=".66" />
        </linearGradient>
      </defs>
      <g className="calendar-rays" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
        <path d="M104 10v20" />
        <path d="m128 17-9 17" />
        <path d="m145 39-16 9" />
      </g>
      <g transform="rotate(8 76 106)">
        <path d="M32 66c0-12 8-20 20-20h47c12 0 20 8 20 20v15H32V66Z" fill="url(#calendar-cover)" />
        <path d="M32 79h87v69c0 7-5 12-12 12H44c-7 0-12-5-12-12V79Z" fill="url(#calendar-paper)" />
        <g fill="#E7EFFF">
          <path d="M43 91h15v15H43zM66 91h15v15H66zM89 91h15v15H89zM43 114h15v15H43zM66 114h15v15H66zM89 114h15v15H89zM43 137h15v15H43zM66 137h15v15H66z" />
        </g>
      </g>
    </svg>
  );
}
