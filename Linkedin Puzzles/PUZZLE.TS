test('Open invoice PDF', async ({ page }) => {
  await page.goto('https://my-app.example');

  await page.getByRole('link', { name: 'Invoice PDF' }).click();

  const pdf = await page.waitForEvent('popup'); 
  await expect(pdf).toHaveURL(/\.pdf$/);
});
