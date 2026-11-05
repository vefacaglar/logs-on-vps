import { Component, type ReactNode } from "react";
import { usePreferences } from "./Preferences";
class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function ClientBoundary({ children }: { children: ReactNode }) {
  const { t } = usePreferences();
  return (
    <Boundary
      fallback={
        <main className="empty">
          <h1>{t("requestFailed")}</h1>
          <button onClick={() => location.reload()}>{t("retry")}</button>
        </main>
      }
    >
      {children}
    </Boundary>
  );
}
