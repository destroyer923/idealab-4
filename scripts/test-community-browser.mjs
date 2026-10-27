/** Browser regression checks against the real Vite app in an isolated Chromium profile.
 * Run: npm install --no-save --package-lock=false @playwright/test
 *      npx playwright install chromium
 *      node scripts/test-community-browser.mjs
 * No production records are seeded or modified. Collaboration setup uses the app's services.
 */
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "pipe" });
let serverLog = "";
server.stderr.on("data", (data) => { serverLog += data; });
server.stdout.on("data", (data) => { serverLog += data; });
let browser;
const errors = [];
let checks = 0;
const pass = (message) => { checks++; console.log(`PASS ${message}`); };

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* Vite still starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const a = await context.newPage();
  const b = await context.newPage();
  for (const page of [a, b]) page.on("pageerror", (error) => errors.push(error.message));

  const api = (page, method, args = []) => page.evaluate(async ({ method, args }) => {
    const service = await import("/src/lib/api.ts");
    return await service[method](...args);
  }, { method, args });
  const go = async (page, route) => { await page.bringToFront(); await page.goto(`${origin}/#${route}`); };
  const logout = async (page) => {
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  };
  const signup = async (page, fullName, username, email) => {
    await page.getByRole("tab", { name: "Create account", exact: true }).click();
    await page.getByLabel("Full name").fill(fullName);
    await page.getByLabel("Username", { exact: false }).fill(username);
    await page.getByLabel("Email", { exact: false }).fill(email);
    await page.getByLabel("Password", { exact: false }).fill("only-for-browser-tests-123");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/#\/dashboard$/);
  };

  await go(a, "/");
  await expect(a.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  assert.equal(await api(a, "currentUserId"), null);
  pass("opening the app does not provision or sign in as administrator");
  await signup(a, "Asha Kulkarni", "asha_test", "asha@test.example");
  const aid = await api(a, "currentUserId");
  await go(b, "/");
  await logout(b);
  await signup(b, "Bilal Shaikh", "bilal_test", "bilal@test.example");
  const bid = await api(b, "currentUserId");
  await a.reload();
  assert.equal(await api(a, "currentUserId"), aid);
  pass("ordinary accounts stay isolated across two tabs and refreshes");

  await a.bringToFront();
  await a.getByRole("link", { name: "Messages", exact: true }).click();
  await a.getByRole("button", { name: "New message", exact: true }).click();
  const search = a.getByRole("searchbox", { name: "Search members to message" });
  await search.fill("  SHAIKH ");
  await expect(a.getByRole("button", { name: /Bilal Shaikh/ })).toBeVisible();
  await search.fill("@bilal_te");
  await expect(a.getByRole("button", { name: /Bilal Shaikh/ })).toBeVisible();
  await search.fill("not-existing-person");
  await expect(a.getByText("No members found", { exact: true })).toBeVisible();
  await search.fill("@bilal_test");
  await a.getByRole("button", { name: /Bilal Shaikh/ }).click();
  await expect(a).toHaveURL(/#\/messages\//);
  const conversation = (await api(a, "getConversations"))[0].conversation.id;
  await a.getByRole("textbox", { name: "Message Bilal Shaikh", exact: true }).fill("Namaste Bilal. Can we discuss packaging?");
  await a.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(a.getByText("Namaste Bilal. Can we discuss packaging?", { exact: true }).last()).toBeVisible();
  pass("name/username search, empty results, conversation creation and sending work in the UI");

  await b.bringToFront();
  await expect(b.getByRole("button", { name: "Notifications, 1 unread", exact: true })).toBeVisible();
  await b.getByRole("button", { name: "Notifications, 1 unread", exact: true }).click();
  await b.getByRole("button", { name: /New message from Asha Kulkarni/ }).click();
  await expect(b).toHaveURL(new RegExp(`#\\/messages\\/${conversation}$`));
  await expect(b.getByText("Namaste Bilal. Can we discuss packaging?", { exact: true }).last()).toBeVisible();
  await expect.poll(() => api(b, "unreadMessageCount")).toBe(0);
  await b.getByRole("textbox", { name: "Message Asha Kulkarni", exact: true }).fill("Yes, let us plan an exchange.");
  await b.getByRole("button", { name: "Send message", exact: true }).click();
  await a.bringToFront();
  await expect(a.getByText("Yes, let us plan an exchange.", { exact: true }).last()).toBeVisible();
  await a.reload();
  await expect(a.getByText("Yes, let us plan an exchange.", { exact: true }).last()).toBeVisible();
  assert.equal((await api(a, "getMessages", [conversation, 50])).messages.length, 2);
  await Promise.all([
    api(a, "sendMessage", [conversation, "A concurrent message", "parallel-a"]),
    api(b, "sendMessage", [conversation, "B concurrent message", "parallel-b"]),
  ]);
  assert.equal((await api(a, "getMessages", [conversation, 50])).messages.length, 4, "Web Locks prevent lost concurrent writes between tabs");
  pass("recipient alerts, destination navigation, read receipts, live tab updates and persisted replies work");

  // Exercise real proposal/completion operations; no fabricated completed status.
  const exchange = await api(a, "proposeExchange", [{ recipientId: bid, iProvide: "Vegetable box", iReceive: "Packaging artwork", message: "Original proposal", targetDate: "" }]);
  await api(b, "respondToRequest", [exchange.id, "accept"]);
  await api(a, "submitWork", [exchange.id, "Vegetables delivered", ""]);
  await api(b, "reviewSubmission", [exchange.id, "confirm"]);
  await api(b, "submitWork", [exchange.id, "Artwork delivered", ""]);
  await api(a, "reviewSubmission", [exchange.id, "confirm"]);
  await go(a, "/u/bilal_test?tab=reviews");
  await expect(a.getByRole("heading", { name: "Review a completed exchange" })).toBeVisible();
  const firstStar = a.getByRole("radio", { name: /1 of 5/ });
  await firstStar.focus();
  await a.keyboard.press("End");
  await expect(a.getByRole("radio", { name: /5 of 5/ })).toBeFocused();
  await a.keyboard.press("ArrowLeft");
  await expect(a.getByRole("radio", { name: /4 of 5/ })).toHaveAttribute("aria-checked", "true");
  const feedback = "Original feedback: thoughtful artwork, delivered as agreed.";
  await a.getByLabel("Your feedback for Bilal Shaikh", { exact: false }).fill(feedback);
  await a.getByRole("button", { name: "Submit review", exact: true }).click();
  await expect(a.getByText(feedback, { exact: true })).toBeVisible();
  await expect(a.getByRole("button", { name: "Submit review", exact: true })).toHaveCount(0);
  assert.equal((await api(a, "getPublicProfile", ["bilal_test"])).rating.average, 4);
  await go(b, "/u/bilal_test?tab=reviews");
  await expect(b.getByText(feedback, { exact: true })).toBeVisible();
  await b.reload();
  await expect(b.getByText(feedback, { exact: true })).toBeVisible();
  pass("profile review form, keyboard rating, comment persistence and shared rating summary work");

  // Verify both read and write failure states rather than accepting false success.
  await go(a, `/messages/${conversation}`);
  await a.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) { if (key === "skillswap-rural.db.v1") throw new DOMException("Test quota", "QuotaExceededError"); return original.call(this, key, value); };
  });
  await a.getByRole("textbox", { name: "Message Bilal Shaikh", exact: true }).fill("Keep this draft if storage fails.");
  await a.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(a.getByRole("textbox", { name: "Message Bilal Shaikh", exact: true })).toHaveValue("Keep this draft if storage fails.");
  await expect(a.getByRole("alert").filter({ hasText: "Not sent:" })).toBeVisible();
  await a.evaluate(() => window.__restoreWrites());
  await a.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(a.getByRole("textbox", { name: "Message Bilal Shaikh", exact: true })).toHaveValue("");
  assert.equal((await api(a, "getMessages", [conversation, 50])).messages.filter((m) => m.body === "Keep this draft if storage fails.").length, 1);
  pass("failed sends preserve input and retry saves exactly one message");

  // English/Hindi/Marathi retain original content. Test representative small/large widths.
  for (const language of ["en", "hi", "mr"]) {
    await api(a, "setLanguage", [language]);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      await go(a, "/messages");
      await expect(a.locator("html")).toHaveAttribute("lang", language);
      const overflow = await a.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) {
        await mkdir("artifacts", { recursive: true });
        await a.screenshot({ path: `artifacts/messages-${language}-${width}.png`, fullPage: true });
        console.error(await a.evaluate(() => [...document.querySelectorAll("body *")].map((el) => ({ tag: el.tagName, cls: el.className, text: el.textContent?.slice(0, 80), width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).filter((x) => x.right > innerWidth + 1 && x.width > 0).slice(0, 20)));
      }
      assert.equal(overflow, false, `${language} inbox has no horizontal overflow at ${width}px`);
      await go(a, `/messages/${conversation}`);
      await expect(a.getByText("Keep this draft if storage fails.", { exact: true }).last()).toBeVisible();
      assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${language} conversation fits at ${width}px`);
    }
    await go(a, `/messages/${conversation}`);
    await expect(a.getByText("Keep this draft if storage fails.", { exact: true }).last()).toBeVisible();
    await go(a, "/u/bilal_test?tab=reviews");
    await expect(a.getByText(feedback, { exact: true })).toBeVisible();
  }
  await a.setViewportSize({ width: 390, height: 844 });
  await go(a, "/u/bilal_test?tab=reviews");
  await expect(a.getByText(feedback, { exact: true })).toBeVisible();
  const profileOverflow = await a.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (profileOverflow) console.error(await a.evaluate(() => [...document.querySelectorAll("body *")].map((el) => ({ tag: el.tagName, cls: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).filter((x) => x.right > innerWidth + 1 && x.width > 0).slice(0, 20)));
  assert.equal(profileOverflow, false, "profile reviews fit on mobile");
  await mkdir("artifacts", { recursive: true });
  await a.screenshot({ path: "artifacts/profile-reviews-mobile.png", fullPage: true });
  pass("three languages retain user content and inbox stays within 360/390/768/1024/1440px viewports");
  assert.deepEqual(errors, [], `No uncaught browser errors: ${errors.join("; ")}`);
  pass("no uncaught browser runtime errors");
  console.log(`${checks} browser workflow checks passed. Tests cover same-browser tabs, not separate devices or PostgreSQL.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  if (!checks) console.error(serverLog);
}