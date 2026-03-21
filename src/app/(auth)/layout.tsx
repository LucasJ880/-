export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div
        className="pointer-events-none absolute -left-32 top-1/4 h-[420px] w-[420px] rounded-full blur-3xl"
        style={{ background: "var(--auth-orb-1)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 bottom-1/4 h-[360px] w-[360px] rounded-full blur-3xl"
        style={{ background: "var(--auth-orb-2)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[280px] w-[90%] max-w-2xl -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "var(--auth-orb-3)" }}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}
