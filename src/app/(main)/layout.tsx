import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-app-mesh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-white/20 bg-white/[0.35] backdrop-blur-[2px]">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
