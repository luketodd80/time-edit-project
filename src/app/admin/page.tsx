import type { Metadata } from "next";
import { AdminView } from "@/components/admin-view";

export const metadata: Metadata = {
  title: "Admin · Time gap review",
  description: "Shop sign-off status and the utilization change from applied edits.",
};

export default function AdminPage() {
  return <AdminView />;
}
