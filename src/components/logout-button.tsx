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
  className = "button-secondary",
}: LogoutButtonProps) {
  return (
    <form action={logout}>
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
