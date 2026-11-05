import { useEffect, useRef, type ReactNode } from "react";
import { usePreferences } from "../app/Preferences";
import styles from "./Dialog.module.css";
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = usePreferences();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section>
        <header>
          <h2>{title}</h2>
          <button
            className="text-button"
            aria-label={t("close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </section>
    </dialog>
  );
}
