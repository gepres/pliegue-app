// La rejilla de iconos de /design-system ocupa el ancho en escritorio, tableta y móvil, sin desborde.
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const t = checker(`Iconos del catálogo (${BASE})`);
const browser = await openChrome({ port: 9397, profile: `${PROFILE_ROOT}-iconos-ancho` });
const page = await browser.newPage();
for (const [width, mobile, minColumns] of [[1440, false, 8], [1024, false, 6], [768, false, 5], [390, true, 2]]) {
  await page.viewport(width, 900, { mobile, dpr: mobile ? 2 : 1 });
  await page.goto(`${BASE}/design-system?w=${width}`);
  await page.waitFor(`document.querySelector("ul[aria-label='Iconos de la app']")`, { timeout: 20000 });
  await page.sleep(600);
  const m = await page.eval(`(() => {
    const ul = document.querySelector("ul[aria-label='Iconos de la app']");
    const card = ul.parentElement;
    const wide = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 3).map((el) => el.tagName + "." + String(el.className).slice(0, 40));
    return { columns: getComputedStyle(ul).gridTemplateColumns.split(" ").length, ul: Math.round(ul.getBoundingClientRect().width), card: Math.round(card.getBoundingClientRect().width), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide };
  })()`);
  t.check(`${width}px: la rejilla ocupa el ancho de la tarjeta (${m.columns} columnas)`, m.columns >= minColumns && m.ul >= m.card * 0.85, JSON.stringify(m));
  t.check(`${width}px: sin desborde de lado`, m.overflow <= 0, JSON.stringify(m.wide));
  await page.eval(`document.querySelector("ul[aria-label='Iconos de la app']").scrollIntoView({ block: "start" }), true`);
  await page.sleep(200);
  await page.screenshot(`${WORK}/iconos-${width}.png`);
}
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
