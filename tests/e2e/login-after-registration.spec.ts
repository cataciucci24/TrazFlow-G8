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

test("el login informa credenciales inválidas sin exponer detalles internos", async ({ page }) => {
  // Simula la respuesta de autenticación para que la demo no dependa de una cuenta real.
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "invalid_credentials", message: "Invalid login credentials" }),
    });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("operador@trazflow.test");
  await page.getByLabel("Contraseña").fill("clave-incorrecta");
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page.getByText("El email o la contraseña no son correctos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
});
