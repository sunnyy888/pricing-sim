// Tests for the game's core. Run: node test.mjs   (loads <script id="core"> from index.html)
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const F = new Function("module", html.match(/<script id="core">([\s\S]*?)<\/script>/)[1] + "; return Fare;")({});
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ": " + d : ""}`); };
const HW = [4.5, 0.9, 0.6, -0.03];

// 1. HW4 2A: Basic $139, Standard $159 (Flex priced out of the market) -> 0.326 / 0.440 / 0.234
{
  const s = F.shares(HW, [139, 159, 1e6]);
  check("HW4 2A shares 0.326 / 0.440 / 0.234", Math.abs(s[0] - 0.326) < 5e-4 && Math.abs(s[1] - 0.440) < 5e-4 && Math.abs(s[3] - 0.234) < 5e-4 && s[2] < 1e-12, s.map(x => x.toFixed(4)).join(" "));
  check("shares sum to 1", Math.abs(F.shares(HW, [120, 150, 180]).reduce((a, b) => a + b) - 1) < 1e-12);
}
// 2. WTP from the colleague's model: bag 0.9/0.03 = $30, flex 0.6/0.03 = $20
{
  const f = { beta: HW, cov: [[1, 0, 0, 0], [0, 1e-4, 0, 0], [0, 0, 1e-4, 0], [0, 0, 0, 1e-8]] };
  check("WTP = -b / b_price", Math.abs(F.wtp(f, 1).w - 30) < 1e-9 && Math.abs(F.wtp(f, 2).w - 20) < 1e-9);
}
// 3. selling: counts add up and match the shares
{
  const rng = F.mulberry32(1), prices = [120, 160, 200], c = F.sell(rng, HW, prices, 400000), s = F.shares(HW, prices);
  check("sell: counts sum to n", c.reduce((a, b) => a + b) === 400000);
  check("sell: frequencies match logit shares", c.every((x, j) => Math.abs(x / 400000 - s[j]) < 4 * Math.sqrt(s[j] * (1 - s[j]) / 400000)), c.map(x => (x / 4000).toFixed(2) + "%").join(" "));
  check("revenue = sum count x price", F.revenue([10, 20, 30, 40], [100, 150, 200]) === 10 * 100 + 20 * 150 + 30 * 200);
}
// 4. optimal prices: equal markup, first-order condition holds, and no nearby prices do better
for (const beta of [HW, [3.8, 1.2, 0.4, -0.025], [5.0, 0.6, 0.9, -0.035]]) {
  const o = F.optimalPrices(beta), m = o.prices[0], a = -beta[3], s0 = F.shares(beta, o.prices)[3];
  const foc = Math.abs(m - 1 / (a * s0));
  let better = false; const h = 0.5;
  for (const d of [[h, 0, 0], [-h, 0, 0], [0, h, 0], [0, -h, 0], [0, 0, h], [0, 0, -h], [h, h, h], [-h, -h, -h], [h, -h, 0], [0, h, -h]])
    if (F.expRevenue(beta, o.prices.map((p, j) => p + d[j])) > o.perTraveler + 1e-9) better = true;
  let gbest = 0;                                       // brute-force grid as an independent check
  for (let p1 = m - 20; p1 <= m + 20; p1 += 2) for (let p2 = m - 20; p2 <= m + 20; p2 += 2) for (let p3 = m - 20; p3 <= m + 20; p3 += 2) gbest = Math.max(gbest, F.expRevenue(beta, [p1, p2, p3]));
  check(`optimal prices for beta = [${beta}]`, foc < 1e-6 && !better && gbest <= o.perTraveler + 1e-9, `all $${m.toFixed(2)}, $${o.perTraveler.toFixed(2)}/traveler, grid best $${gbest.toFixed(2)}`);
}
// 5. the MLE recovers the hidden truth: 300 simulated games of 10 rounds x 800 travelers with varied prices
{
  const G = 300, cover = [0, 0, 0, 0], est = [];
  let fails = 0;
  for (let g = 0; g < G; g++) {
    const rng = F.mulberry32(1000 + g), truth = F.drawTruth(rng), rounds = [];
    for (let r = 0; r < 10; r++) { const prices = [129, 159, 189].map(p => Math.round(p * (0.8 + 0.6 * rng()))); rounds.push({ prices, counts: F.sell(rng, truth, prices, 800) }); }
    const f = F.fit(rounds);
    if (!f.ok) { fails++; continue; }
    est.push(f.beta.map((b, k) => (b - truth[k]) / f.se[k]));
    f.beta.forEach((b, k) => { if (Math.abs(b - truth[k]) <= 1.96 * f.se[k]) cover[k]++; });
  }
  check("fit converges in every simulated game", fails === 0, `${G - fails}/${G}`);
  F.PARAMS.forEach((p, k) => {
    const zs = est.map(e => e[k]), mz = zs.reduce((a, b) => a + b) / zs.length;
    check(`${p}: 95% CI covers the truth ~95% of the time, no bias`, cover[k] / est.length > 0.92 && cover[k] / est.length < 0.98 && Math.abs(mz) < 0.2,
      `coverage ${(100 * cover[k] / est.length).toFixed(1)}%, mean z ${mz.toFixed(3)}`);
  });
}
// 6. gradient = 0 at the fit; constant prices can't identify the price effect
{
  const rng = F.mulberry32(9), truth = F.drawTruth(rng), rounds = [];
  for (let r = 0; r < 10; r++) { const prices = [100 + 10 * r, 150 - 5 * r, 200 + 3 * r]; rounds.push({ prices, counts: F.sell(rng, truth, prices, 800) }); }
  const f = F.fit(rounds);
  check("max |gradient| at the fit < 1e-6", f.ok && f.maxGrad < 1e-6, f.ok ? f.maxGrad.toExponential(1) : "fit failed");
  const flat = Array.from({ length: 10 }, () => ({ prices: [129, 159, 189], counts: F.sell(rng, truth, [129, 159, 189], 800) }));
  const ff = F.fit(flat);
  check("never changing prices -> fit refuses (not identified)", !ff.ok, ff.reason || "");
}
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
