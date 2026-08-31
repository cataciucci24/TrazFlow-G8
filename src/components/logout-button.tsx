import type { ReactNode } from "react";

import { logout } from "@/lib/auth/actions";

type LogoutButtonProps = {
  children?: ReactNode;
  className?: string;
};

/**
 * Botón de logout. Es un <form> con Server Action, así que funciona igual
 * aunque el JS todavía no haya hidratado.
 */
export function LogoutButton({
  children = "Cerrar sesión",
  className = "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100",
}: LogoutButtonProps) {
  return (
    <form action={logout}>
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
