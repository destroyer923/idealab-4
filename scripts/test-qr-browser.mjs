import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { stdio: "pipe" },
);

let browser;
const pageErrors = [];
let passed = 0;
const pass = (msg) => {
  passed++;
  console.log(`PASS ${msg}`);
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* waiting for Vite */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const p of [tabA, tabB]) p.on("pageerror", (e) => pageErrors.push(e.message));

  const go = async (page, route) => {
    await page.bringToFront();
    await page.goto(`${origin}/#${route}`);
  };
  const logout = async (page) => {
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Sign in", exact: true })).toBeVisible();
  };
  const signup = async (page, fullName, username, email) => {
    await page.getByRole("tab", { name: "Create account", exact: true }).click();
    await page.getByLabel("Full name").fill(fullName);
    await page.getByLabel("Username", { exact: false }).fill(username);
    await page.getByLabel("Email", { exact: false }).fill(email);
    await page.getByLabel("Password", { exact: false }).fill("browser-test-pass-123");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/#\/dashboard$/);
  };

  // 1. Unauthenticated initial state + 3 auth tabs.
  await go(tabA, "/");
  await expect(tabA.getByRole("tab", { name: "Sign in", exact: true })).toBeVisible();
  await expect(tabA.getByRole("tab", { name: "Create account", exact: true })).toBeVisible();
  await expect(tabA.getByRole("tab", { name: "Enter as Admin", exact: true })).toHaveCount(0);
  pass("initial visitor starts unauthenticated with normal sign-in and signup options only");

  // 2. Register two ordinary accounts and verify sidebar items.
  await signup(tabA, "Asha Kulkarni", "asha_qr_ui", "asha@ui.test");
  await expect(tabA.getByRole("link", { name: "QR Code", exact: true })).toBeVisible();
  await expect(tabA.getByRole("link", { name: "Scan QR Code", exact: true })).toBeVisible();
  await expect(tabA.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

  await go(tabB, "/");
  await signup(tabB, "Bilal Shaikh", "bilal_qr_ui", "bilal@ui.test");
  await expect(tabB.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  pass("My Activity sidebar shows QR Code and Scan QR Code, and hides Admin from ordinary users");

  // 3. Distinct personal QR codes + persistence across reload.
  await tabA.bringToFront();
  await tabA.getByRole("link", { name: "QR Code", exact: true }).click();
  await expect(tabA).toHaveURL(/#\/qr-code$/);
  const imgA = tabA.getByRole("img", { name: "Personal QR code for Asha Kulkarni" });
  await expect(imgA).toBeVisible();
  await expect(tabA.getByRole("button", { name: "Download QR Code", exact: true })).toBeVisible();
  await expect(tabA.getByRole("button", { name: "Copy Profile Link", exact: true })).toBeVisible();
  const srcA = await imgA.getAttribute("src");

  await tabB.bringToFront();
  await tabB.getByRole("link", { name: "QR Code", exact: true }).click();
  const imgB = tabB.getByRole("img", { name: "Personal QR code for Bilal Shaikh" });
  await expect(imgB).toBeVisible();
  const srcB = await imgB.getAttribute("src");
  assert.ok(srcA?.startsWith("data:image/png;base64,") && srcB?.startsWith("data:image/png;base64,"));
  assert.notEqual(srcA, srcB, "two accounts render distinct QR code images");
  await tabB.reload();
  await expect(tabB.getByRole("img", { name: "Personal QR code for Bilal Shaikh" })).toHaveAttribute("src", srcB);
  pass("distinct personal QR codes render and persist across reload");

  // 4. Denied camera permission + invalid manual code + real QR PNG image scan!
  await tabA.bringToFront();
  await tabA.getByRole("link", { name: "Scan QR Code", exact: true }).click();
  await expect(tabA).toHaveURL(/#\/scan-qr$/);
  await tabA.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await tabA.getByRole("button", { name: "Start Camera Scan", exact: true }).click();
  await expect(tabA.getByRole("alert").filter({ hasText: "Camera permission was denied" })).toBeVisible();

  await tabA.getByLabel("Profile link or connection token").fill("invalid_qr_payload");
  await tabA.getByRole("button", { name: "Find Member", exact: true }).click();
  await expect(tabA.getByRole("alert").filter({ hasText: "Invalid or unsupported QR code" })).toBeVisible();

  // Upload Account B's actual generated QR PNG buffer and verify browser decoding!
  const pngBuffer = Buffer.from(srcB.split(",")[1], "base64");
  await tabA.locator('input[type="file"]').setInputFiles({
    name: "bilal-qr.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await expect(tabA.getByRole("heading", { name: "Bilal Shaikh" })).toBeVisible();
  await expect(tabA.getByRole("button", { name: "Add Friend", exact: true })).toBeVisible();
  pass("denied camera permission, invalid QR handling, and real QR image decoding work");

  // 5. Friend request -> persist -> recipient notification -> accept -> real messaging!
  await tabA.getByRole("button", { name: "Add Friend", exact: true }).click();
  await expect(tabA.getByText("Request Sent", { exact: true })).toBeVisible();
  await tabA.reload();
  await tabA.getByRole("tab", { name: /Sent Requests/ }).click();
  await expect(tabA.getByRole("link", { name: "Bilal Shaikh" })).toBeVisible();

  await tabB.bringToFront();
  await expect(tabB.getByRole("button", { name: /Notifications, 1 unread/ })).toBeVisible();
  await tabB.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  await tabB.getByRole("button", { name: /Asha Kulkarni sent you a friend request/ }).click();
  await expect(tabB).toHaveURL(/#\/u\/asha_qr_ui$/);
  await tabB.getByRole("button", { name: "Accept Request", exact: true }).click();
  await expect(tabB.getByText("Friends", { exact: true }).first()).toBeVisible();

  await tabB.getByRole("button", { name: "Message", exact: true }).click();
  await expect(tabB).toHaveURL(/#\/messages\//);
  await tabB.getByRole("textbox", { name: "Message Asha Kulkarni", exact: true }).fill("Connected through QR! Ready to exchange.");
  await tabB.getByRole("button", { name: "Send message", exact: true }).click();

  await tabA.bringToFront();
  await tabA.getByRole("link", { name: "Messages", exact: true }).click();
  await expect(tabA.getByText("Connected through QR! Ready to exchange.")).toBeVisible();
  pass("friend request, notification, acceptance, and connected messaging work end-to-end");

  assert.deepEqual(pageErrors, []);
  console.log(`All ${passed} QR/Connections browser checks passed.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
