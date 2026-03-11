"use client";

import { createContext, useContext, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

interface AdminAuth {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
  companySlug: string | null;
}

interface AdminCompanyContextValue {
  /** The resolved company slug (from URL for super_admin, from JWT for company admin) */
  companySlug: string;
  /** Whether the current user is a super_admin */
  isSuperAdmin: boolean;
  /** The admin auth data */
  admin: AdminAuth | null;
  /** Build an admin API URL with the company param included */
  adminApiUrl: (path: string) => string;
  /** Whether auth data is still loading */
  isLoading: boolean;
}

const AdminCompanyContext = createContext<AdminCompanyContextValue>({
  companySlug: "",
  isSuperAdmin: false,
  admin: null,
  adminApiUrl: (path) => path,
  isLoading: true,
});

/** Extract company slug from subdomain: husasmidjan.snid.is → "husasmidjan" */
function getSubdomainSlug(): string {
  if (typeof window === "undefined") return "";
  const hostname = window.location.hostname;
  // Production: slug.snid.is
  if (hostname.endsWith(".snid.is") && hostname !== "snid.is") {
    const sub = hostname.split(".")[0];
    if (sub !== "admin") return sub;
  }
  return "";
}

export function AdminCompanyProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const companyParam = searchParams.get("company") || "";
  const subdomainSlug = useMemo(() => getSubdomainSlug(), []);

  const { data: authData, isLoading } = useQuery<{ admin: AdminAuth }>({
    queryKey: ["/api/auth/me"],
  });

  const admin = authData?.admin || null;
  const isSuperAdmin = admin?.role === "super_admin";

  // For super_admin: use URL ?company= param, or subdomain slug as fallback
  // For company admin: use their assigned company slug from JWT
  const companySlug = isSuperAdmin
    ? (companyParam || subdomainSlug)
    : (admin?.companySlug || companyParam || subdomainSlug);

  const adminApiUrl = useMemo(() => {
    return (path: string) => {
      if (!companySlug) return path;
      const separator = path.includes("?") ? "&" : "?";
      return `${path}${separator}company=${companySlug}`;
    };
  }, [companySlug]);

  const value = useMemo(() => ({
    companySlug,
    isSuperAdmin,
    admin,
    adminApiUrl,
    isLoading,
  }), [companySlug, isSuperAdmin, admin, adminApiUrl, isLoading]);

  return (
    <AdminCompanyContext.Provider value={value}>
      {children}
    </AdminCompanyContext.Provider>
  );
}

export function useAdminCompany() {
  return useContext(AdminCompanyContext);
}
