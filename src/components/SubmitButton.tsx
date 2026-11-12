"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} aria-hidden /> : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
