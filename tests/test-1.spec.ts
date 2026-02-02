import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://gemini.google.com/app');
  await page.getByRole('textbox', { name: 'Enter a prompt here' }).getByRole('paragraph').click();
  await page.locator('.ql-clipboard').fill('Who is Leonardo De Caprio ?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.locator('.ql-clipboard').fill('Why people think about politics so much?');
  await page.getByRole('textbox', { name: 'Enter a prompt here' }).press('ControlOrMeta+z');
  await page.getByRole('paragraph').filter({ hasText: /^$/ }).click();
  await page.locator('.ql-clipboard').fill('Why people think about politics so much?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('paragraph').filter({ hasText: /^$/ }).click();
  await page.locator('.ql-clipboard').fill('What is 9+10?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('paragraph').filter({ hasText: /^$/ }).click();
  await page.locator('.ql-clipboard').fill('Where do actors learn acting? ');
  await page.getByRole('button', { name: 'Send message' }).click();
  
});