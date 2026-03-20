/**
 * 登录/注册页共享 class，与 docs/DESIGN_SPEC_PHASE1.md 对齐（二期：玻璃卡 + 靛青主色）
 */
export const authInputClass =
  "w-full min-h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-white/60 px-3 py-2 text-sm text-foreground outline-none backdrop-blur-sm transition-shadow placeholder:text-muted focus:border-accent focus:bg-white/80 focus:ring-2 focus:ring-[var(--accent-soft)]";

export const authLabelClass =
  "mb-1 block text-sm font-medium text-foreground/90";

export const authPrimaryButtonClass =
  "min-h-10 w-full rounded-[var(--radius-md)] bg-gradient-to-b from-[#4f46e5] to-[#3730a3] py-2.5 text-sm font-medium text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_14px_rgba(55,48,163,0.35)] transition-all duration-200 ease-out hover:from-[#4338ca] hover:to-[#312e81] hover:shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_6px_20px_rgba(55,48,163,0.4)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

export const authCardClass =
  "rounded-[var(--radius-lg)] border border-white/50 bg-white/55 p-8 shadow-float backdrop-blur-xl supports-[backdrop-filter]:bg-white/45";
