/** @jsxImportSource react */

export function JumpToLatestGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      stroke="currentColor"
      className={`box-border inline-block size-6 p-[3px] text-[18px] leading-none ${props.className ?? ""}`.trim()}
      style={{ fontSize: "18px" }}
      aria-hidden
    >
      <path
        d="M18.5651 13.9344C18.8775 14.2468 18.8775 14.7528 18.5651 15.0652L13.274 20.3562C12.5731 21.0571 11.4321 21.063 10.7272 20.3582L5.4342 15.0652C5.1219 14.7528 5.1219 14.2468 5.4342 13.9344C5.74659 13.622 6.25264 13.622 6.56506 13.9344L11.1998 18.5691L11.1998 2.9998C11.1998 2.55803 11.5579 2.2001 11.9996 2.2C12.4415 2.2 12.7994 2.55797 12.7994 2.9998L12.7994 18.5691L17.4342 13.9344C17.7466 13.622 18.2526 13.622 18.5651 13.9344Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.8}
        vectorEffect="nonScalingStroke"
      />
    </svg>
  );
}
