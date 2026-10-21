// AmButton: every button and button-styled link in the app.
//
// Logic lives here; presentation lives in AmButton.module.css. Like Ambrook's
// AmButton, it handles every combination of behavior in one place: an href
// (renders a link), an onClick, both, or neither. So a button looks the same
// whatever it does, and callers never pick between <a> and <button>.

import type { JSX, MouseEvent, ReactNode } from "react";
import styles from "./AmButton.module.css";

export type AmButtonProps = {
  children: ReactNode;
  /** primary: the one main action. secondary: everything else. ghost: low emphasis. link: inline text. */
  variant?: "primary" | "secondary" | "ghost" | "link";
  size?: "small" | "medium";
  /** On a dark background (the bulk-action bar). Ambrook's version calls this `light`. */
  onDark?: boolean;
  href?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  startIcon?: ReactNode;
  type?: "button" | "submit";
  /** For layout only (position, margins). Never for color or shape: that's the variant's job. */
  className?: string;
  title?: string;
  "aria-label"?: string;
};

export function AmButton({
  children,
  variant = "secondary",
  size = "medium",
  onDark = false,
  href,
  onClick,
  disabled = false,
  startIcon,
  type = "button",
  className,
  ...aria
}: AmButtonProps): JSX.Element {
  const classes = [styles.button, styles[variant], styles[size], onDark && styles.onDark, className].filter(Boolean).join(" ");
  const content = (
    <>
      {startIcon && <span className={styles.icon}>{startIcon}</span>}
      {children}
    </>
  );

  // A disabled link isn't a link: render a disabled button so it can't be followed or focused.
  if (href && !disabled) {
    return (
      <a className={classes} href={href} onClick={onClick} {...aria}>
        {content}
      </a>
    );
  }
  return (
    <button className={classes} type={type} onClick={onClick} disabled={disabled} {...aria}>
      {content}
    </button>
  );
}
