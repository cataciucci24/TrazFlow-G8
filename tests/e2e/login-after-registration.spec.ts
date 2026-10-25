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
  // El login actual es cliente. El fixture responde un rechazo real por HTTP.
  await page.goto("/login");
  await page.getByLabel("Email").fill("operador@trazflow.test");
  await page.getByLabel("Contraseña").fill("clave-incorrecta");
  const responsePromise = page.waitForResponse(response => response.url().includes('/auth/v1/token'));
  await page.getByRole("button", { name: "Ingresar" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'invalid_credentials' });
  expect(response.request().postDataJSON()).toMatchObject({ email: 'operador@trazflow.test', password: 'clave-incorrecta' });

  await expect(page.getByText("El email o la contraseña no son correctos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
});

test("una caída de red tiene un mensaje distinto al rechazo de credenciales", async ({ page }) => {
  await page.route('**/auth/v1/token**', route => route.abort('connectionrefused'));
  await page.goto('/login');
  await page.getByLabel('Email').fill('chofer@trazflow.test');
  await page.getByLabel('Contraseña').fill('test1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('No se pudo ingresar. Revisá tu conexión e intentá nuevamente.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
});
