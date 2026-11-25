import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon";
import styles from "./rows.module.css";

/** The bar that opens a list screen: a way back and the screen's name. */
export function ScreenBar({
  title,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  /** A control at the end of the bar. */
  children?: ReactNode;
}) {
  return (
    <header className={styles.bar}>
      <Link href={backHref} className={styles.back} aria-label={backLabel} prefetch={false}>
        <Icon name="chevron" />
      </Link>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/** A named group of rows in one card. */
export function RowGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.group} aria-label={title}>
      {title && <h2>{title}</h2>}
      <div className={styles.card}>{children}</div>
    </section>
  );
}

type RowLook = {
  icon?: IconName;
  title: ReactNode;
  /** A second, quieter line under the title. */
  sub?: ReactNode;
  /** Short text at the end, before the chevron. */
  value?: ReactNode;
  /** Replaces the chevron: a pill, a count, a switch. */
  end?: ReactNode;
  tone?: "danger";
};
type RowTarget =
  | { href: string; onClick?: () => void; current?: boolean }
  | { onClick: () => void; disabled?: boolean; href?: undefined }
  | { href?: undefined; onClick?: undefined };

/** One line of a list card: a link, a button, or plain text when it leads nowhere. */
export function Row(props: RowLook & RowTarget) {
  const { icon, title, sub, value, end, tone } = props;
  const leads = props.href !== undefined || props.onClick !== undefined;
  const inner = (
    <>
      {icon && <Icon name={icon} className={styles.icon} />}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
      {value && <span className={styles.value}>{value}</span>}
      {end ?? (leads && <Icon name="chevron" className={styles.chevron} />)}
    </>
  );
  const shared = { className: styles.row, "data-two": sub ? "" : undefined, "data-tone": tone };
  if (props.href !== undefined)
    return (
      <Link
        {...shared}
        href={props.href}
        prefetch={false}
        aria-current={props.current ? "page" : undefined}
        onClick={props.onClick}
      >
        {inner}
      </Link>
    );
  if (props.onClick !== undefined)
    return (
      <button {...shared} type="button" disabled={props.disabled} onClick={props.onClick}>
        {inner}
      </button>
    );
  return <div {...shared}>{inner}</div>;
}

/** A small mark at the end of a row: done, waiting, or not available yet. */
export function RowPill({ kind, children }: { kind: "ok" | "wait" | "off"; children: ReactNode }) {
  return (
    <span className={styles.pill} data-kind={kind}>
      {children}
    </span>
  );
}

export const rowStyles = styles;
