// PrimaryButton: the one action per chapter. tone="amber" for signing (Touch ID). Shows a spinner while busy.
// <PrimaryButton icon={Fingerprint} tone="amber" busy={busy} onClick={sign}>Sign with Touch ID</PrimaryButton>
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { LoaderCircle, type LucideIcon } from "lucide-react";

export function PrimaryButton({
  children,
  onClick,
  icon: Icon,
  tone = "light",
  busy = false,
  disabled = false,
  variant = "solid",
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: LucideIcon;
  tone?: "light" | "amber" | "red";
  busy?: boolean;
  disabled?: boolean;
  variant?: "solid" | "ghost";   // ghost = secondary action next to a solid one
}) {
  const solid = {
    light: "bg-fg text-ink hover:bg-white",
    amber: "bg-amber text-ink hover:bg-[#ffc45c] shadow-[0_10px_40px_-12px_rgba(245,181,68,0.55)]",
    red: "bg-red text-ink hover:bg-[#ff7276]",
  }[tone];
  const ghost = "border border-line-strong text-fg hover:border-muted hover:bg-white/[0.03]";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      whileTap={{ scale: 0.97 }}
      className={`inline-flex h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${variant === "solid" ? solid : ghost}`}
    >
      {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : Icon && <Icon size={18} strokeWidth={2} aria-hidden />}
      {children}
    </motion.button>
  );
}
