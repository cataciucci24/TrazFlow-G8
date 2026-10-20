import { expect, test } from "@playwright/test";

test("una persona que vuelve del registro ve la confirmación y puede iniciar sesión", async ({ page }) => {
  // El parámetro representa la redirección posterior a crear la cuenta.
  await page.goto("/login?registered=1");

  await expect(page.getByText("Cuenta creada. Iniciá sesión para completar tu solicitud de acceso.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bienvenido a TrazFlow" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
});
