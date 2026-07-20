"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  authCardClass,
} from "@/lib/auth-styles";
import {
  OrgActivePicker,
  type OrgActiveOption,
} from "@/components/org-active-picker";
import {
  hydrateStoredOrgId,
  selectActiveOrganization,
} from "@/lib/org-selection";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function SelectOrgContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));

  const [orgs, setOrgs] = useState<OrgActiveOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/active-org", {
          credentials: "include",
        });
        if (!res.ok) {
          if (res.status === 401) {
            router.replace(`/login?next=${encodeURIComponent("/select-org")}`);
            return;
          }
          throw new Error("加载组织失败");
        }
        const data = await res.json();
        if (cancelled) return;

        const list = (data.organizations ?? []) as OrgActiveOption[];
        setOrgs(list);

        if (data.activeOrgId) {
          hydrateStoredOrgId(data.activeOrgId);
          window.location.href = next;
          return;
        }
        if (list.length === 1) {
          const r = await selectActiveOrganization(list[0].id);
          if (r.ok) {
            window.location.href = next;
            return;
          }
        }
        if (list.length === 0) {
          window.location.href = next;
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function handleSelect(orgId: string) {
    setBusyId(orgId);
    setError("");
    const r = await selectActiveOrganization(orgId);
    if (!r.ok) {
      setError(r.error || "选择失败");
      setBusyId(null);
      return;
    }
    window.location.href = next;
  }

  if (loading) {
    return (
      <div className={`${authCardClass} flex min-h-[280px] items-center justify-center`}>
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className={authCardClass}>
      {error && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[rgba(166,61,61,0.15)] bg-danger-bg px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      <OrgActivePicker
        organizations={orgs}
        busyId={busyId}
        onSelect={handleSelect}
      />
    </div>
  );
}

export default function SelectOrgPage() {
  return (
    <Suspense
      fallback={
        <div className={`${authCardClass} flex min-h-[280px] items-center justify-center`}>
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      }
    >
      <SelectOrgContent />
    </Suspense>
  );
}
