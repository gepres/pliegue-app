"use client";

import { useEffect, useState } from "react";

import { onBudgetAlert } from "../../ai/ai-usage-store";
import { Toast } from "../app-ui/controls";

/** Al cruzar el 80 % o el 100 % de un límite del presupuesto de IA, un aviso (04.6). */
export function BudgetAlerts() {
  const [alert, setAlert] = useState<{ nonce: number; text: string } | null>(null);
  useEffect(() => onBudgetAlert((text) => setAlert((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, text }))), []);
  return <Toast message={alert?.text ?? null} nonce={alert?.nonce ?? 0} />;
}
