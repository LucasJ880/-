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
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-white/15 bg-[rgba(250,248,244,0.4)] backdrop-blur-[2px]">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-6 py-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
