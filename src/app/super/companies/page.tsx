"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CompaniesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/super"); }, [router]);
  return null;
}
