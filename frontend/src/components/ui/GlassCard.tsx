import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  onClick?: () => void;
}

// Glaskarte: halbtransparente Füllung + feine Umrandung + weicher Schatten + oberes Innen-Highlight (Basis-Container im Tech-Glas-Warmorange-Stil).
export function GlassCard({ children, className, glow, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "glass p-5",
        glow && "glass-glow",
        onClick && "cursor-pointer transition-transform hover:-translate-y-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
