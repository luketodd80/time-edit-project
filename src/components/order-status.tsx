import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/review";
import type { OrderStatus } from "@/lib/types";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant={status === "invoiced" ? "destructive" : status === "office" ? "secondary" : "outline"}>
      {statusLabel(status)}
    </Badge>
  );
}
