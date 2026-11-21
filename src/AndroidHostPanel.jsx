import { useEffect, useRef } from "react";

export default function AndroidHostPanel({ page, onClose }) {
  const dialog = useRef(null);
  const frame = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    function message(event) {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "crapstv:close-host-panel") onClose();
    }
    function permission(event) {
      frame.current?.contentWindow.postMessage(
        { type: "crapstv:network-help", reason: event.detail },
        location.origin,
      );
    }
    window.addEventListener("message", message);
    window.addEventListener("crapstv:network-help", permission);
    return () => {
      window.removeEventListener("message", message);
      window.removeEventListener("crapstv:network-help", permission);
    };
  }, [onClose]);
  return (
    <dialog
      ref={dialog}
      aria-label="Android hosting"
      className="android-host-panel"
      onClose={onClose}
    >
      <iframe
        ref={frame}
        title="CrapsTV hosting controls"
        src={`/android-host?view=${page}`}
      />
    </dialog>
  );
}
