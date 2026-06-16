import type { ReactNode } from "react";

type DisclosurePanelProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  meta?: string;
};

export const DisclosurePanel = ({
  title,
  children,
  defaultOpen = false,
  meta,
}: DisclosurePanelProps) => (
  <details className="disclosure-panel" open={defaultOpen}>
    <summary>
      <span>{title}</span>
      {meta ? <small>{meta}</small> : null}
    </summary>
    <div className="disclosure-body">{children}</div>
  </details>
);
