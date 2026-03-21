"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

export interface OrgSummary {
  id: string;
  name: string;
  code: string;
  status: string;
  planType: string;
  memberCount: number;
  projectCount: number;
  myRole: string | null;
}

interface UseOrganizationsReturn {
  organizations: OrgSummary[];
  loading: boolean;
  reload: () => void;
}

export function useOrganizations(): UseOrganizationsReturn {
  const [organizations, setOrganizations] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch("/api/organizations")
      .then((r) => r.json())
      .then((d) => setOrganizations(d.organizations ?? []))
      .catch(() => setOrganizations([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { organizations, loading, reload };
}
