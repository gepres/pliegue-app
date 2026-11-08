"use client";

import { useEffect } from "react";

import { syncKeyVault } from "../../ai/key-vault";
import { useAccount } from "../../cloud/account-store";

/**
 * Carga las claves guardadas (02.5) al abrir la app y las pone al día con la cuenta: al iniciar
 * o cerrar sesión, o al cambiar de cuenta. Mientras la cuenta se comprueba no hace nada, para no
 * borrar por error lo de «hasta cerrar sesión».
 */
export function KeyVaultLoader() {
  const account = useAccount();
  const known = account.status !== "loading";
  const userId = account.status === "signed-in" ? account.userId : null;
  useEffect(() => {
    if (known) void syncKeyVault(userId);
  }, [known, userId]);
  return null;
}
