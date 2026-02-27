"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/super"); }, [router]);
  return null;
}
