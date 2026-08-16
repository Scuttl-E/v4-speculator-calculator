# V4 Speculator / Price Model

An independent Windows desktop and web modelling tool for exploring potential Peapods Finance V4 strategy behaviour across different underlying-asset price moves.

V4 Speculator combines modelled Long V4 and Short V4 products, compares cash and spot-asset Cashback routing, applies independent leg-risk constraints, and tests the resulting strategy against spot, leveraged lending positions, and perpetual futures.

> **Web version:** The experimental web build contains the latest feature set and may change while development continues. Try it at [scuttl-e.github.io/v4-speculator-calculator](https://scuttl-e.github.io/v4-speculator-calculator/).

> [!IMPORTANT]
> **Unofficial V4 model**
>
> This project is independent and unofficial. It is not produced by, affiliated with, or endorsed by Peapods Finance. The V4 calculations are estimates reconstructed from publicly released charts, examples, posts, and technical material. Where full mechanics are unavailable, the model uses inferred behaviour. Treat every result as a scenario estimate rather than an authoritative protocol quote.

---

## What it does

V4 Speculator can:

- combine independently selected Long V4 and Short V4 products;
- allocate capital continuously between the Long and Short sides;
- model the `50% LTV`, `75% LTV Cashback`, and `75% LTV` products on either side;
- route Cashback to fixed cash or a spot-asset holding;
- let the optimiser exclude, require, or automatically assess Cashback products;
- constrain Long and Short products independently to 50% or 75% LTV;
- enforce maximum isolated-leg drawdown across a configurable analysis range;
- optimise for bullish, bearish, parity, and full-range benchmark objectives;
- compare V4 with spot, leveraged lending positions, and perpetual futures;
- stop lending and perp comparisons at their supplied liquidation boundaries;
- inspect the combined strategy and its independent Long and Short curves;
- decompose Cashback inside the chart tooltip;
- compare the selected Cashback route with the best opposing route; and
- inspect exact scenario values, position accounting, and the equations used by the model.

The app is a price-response modeller, not a price predictor. It asks:

**Given a range of possible prices, which modelled V4 configuration best matches the risk and return profile you want?**

---

## Harvester

Harvester is an interactive, chart-led workspace for planning V4 cash withdrawals while preserving final benchmark parity.

Set a final target, then fine-tune checkpoints or choose an automated plan to see the cash you can extract while retaining equivalent benchmark exposure at that target.

Use it to:

- build a custom withdrawal schedule by adding, moving, and editing checkpoints directly on the chart;
- compare it with **Max Harvest Rate**, **Max Equal Harvest**, and **Fastest Capital Recovery** plans;
- adjust the target, benchmark, interval, checkpoint count, and first checkpoint;
- inspect each checkpoint's withdrawal and remaining V4 value; and
- review total harvested cash, remaining active V4, initial Cashback, total wealth, benchmark parity, and capital recovery.

Harvester is a separate planning workspace: opening, editing, or closing it does not alter the calculator's underlying V4 configuration.

---

## V4 products

Long and Short each have the same three user-facing product choices.

### 50% LTV

The base product. It keeps the full position inside V4 and does not create a Cashback partition.

### 75% LTV Cashback

The eligible curve is partitioned once:

- 50% remains in the V4 product curve; and
- the other 50% becomes Cashback routed either to cash or to the spot asset.

Cash routing remains fixed as the asset price changes. Spot-asset routing buys the underlying at entry and therefore moves with its price.

### 75% LTV

The protocol-native retained product. No cash is released to the user; the same value remains inside the V4 position as additional deployed capital.

This is a single product outcome. The retained amount is not multiplied again, recursively recycled, or counted simultaneously as external Cashback.

### Accounting rule

The Cashback partition exists in exactly one place:

- outside V4 as cash;
- outside V4 as spot asset; or
- retained inside the 75% LTV product.

It is never counted in two places at once. The same product choices and partition rules are available to both Long and Short.

---

## Comparison modes

### Base

Models V4 using a user-entered deposit and compares it directly with holding the underlying asset.

Use Base to design standalone bullish, bearish, balanced, parity, or benchmark-dominance strategies.

![Base mode showing the V4 strategy response against spot](docs/screenshots/base-mode.png)

### Lending Position

Models an existing collateralised lending position from:

- asset amount and current price;
- USD debt; and
- liquidation LTV.

The app derives collateral value, net equity, current LTV, liquidation price, and liquidation move. Current net equity becomes the equivalent V4 deposit for a like-for-like comparison.

The lending comparator ends at liquidation instead of continuing as an artificial zero-value position.

![Lending Position mode comparing V4 with a collateralised lending position](docs/screenshots/lending-position-mode.png)

### Perp Position

Models an existing linear perpetual-futures position from:

- current or mark price;
- average entry price;
- side and position size;
- margin or collateral;
- current unrealised PnL; and
- a user-supplied liquidation price.

Current perp equity becomes the equivalent V4 deposit. The comparator ends at the supplied liquidation boundary; venue-specific margin engines are not recreated.

Funding, trading fees, and other time-dependent perp costs remain outside the price model.

![Perp Position mode comparing V4 with a perpetual futures position](docs/screenshots/perp-position-mode.png)

---

## Manual and Optimise modes

### Manual

Manual mode lets the user directly choose:

- the Long/Short capital split;
- the Long product;
- the Short product; and
- whether an active Cashback partition is held as cash or as spot asset.

Selecting a product immediately updates the chart, scenario table, Position Breakdown, and risk readouts.

### Optimise

Optimise searches the permitted Long product, Short product, Cashback route, and allocation grid for the best configuration under the active objective and constraints.

Cashback product policy can be:

- **Off:** exclude `75% LTV Cashback` from both sides;
- **Forced:** require at least one active Cashback product; or
- **Auto:** compare Cashback and non-Cashback products.

Cashback routing can be:

- **Cash**;
- **Spot asset**; or
- **Auto**, allowing both routes to compete.

Changing a relevant input marks the previous result as stale. The optimiser only recalculates when the user explicitly runs it.

Fresh installations include generated default results for every valid objective in Base, Lending Position, and Perp Position modes.

### Product and routing decision

When a bullish optimisation selects a Cashback product, the analytical panel shows:

- the selected route and return at the active bullish target;
- the best re-optimised result using the opposing route; and
- the selected route's advantage in percentage points and relative percent.

This comparison reruns the opposing route through the optimiser rather than merely changing the route on the already-selected configuration.

---

## Optimiser objectives

### Maximise Bullish Exposure

Maximises V4 value at a selected positive asset-price target while respecting the active isolated-leg drawdown constraint.

### Maximise Bearish Exposure

Maximises V4 value at a selected negative target. The Downside Recovery analysis shows the intermediate trough, target return, and recovery between them.

### Spot Parity / Protection

Seeks a configuration that meets or exceeds spot at the selected target and then prefers stronger downside protection. The analysis compares V4 return, spot return, parity margin, and protection gained.

### Lending Position Parity

Available in Lending Position mode. Seeks the closest achievable match to the lending comparator at the selected target and shows V4 value at the lending liquidation level.

If exact parity is not feasible, the optimiser retains the best achievable result instead of failing without a configuration.

### Perp Position Parity

Available in Perp Position mode. Uses the same best-achievable parity behaviour against the perpetual-futures comparator and reports V4 at the supplied perp liquidation level.

### Benchmark Dominance

Scores V4 against the active benchmark across the full valid tested range:

- Base uses spot;
- Lending Position uses the lending comparator up to liquidation; and
- Perp Position uses the perp comparator up to liquidation.

For each candidate:

```text
Edge = V4 return - benchmark return
```

The optimiser first maximises the candidate's worst edge, then its average edge, then prefers lower maximum drawdown when earlier measures are effectively tied.

---

## Risk and strategy controls

### Max leg drawdown

The optimiser measures the worst modelled drawdown of either active V4 leg independently. A profitable Short leg cannot conceal an unacceptable Long-leg loss, and vice versa.

The default limit is **50%**, the adjustable maximum is **99%**, and the control supports 0.1 percentage-point increments.

### Analysis range

Defines the underlying-price interval used for isolated-leg drawdown and other full-range calculations. It defaults to **-99% through +200%** and is independent from objective targets and chart zoom.

### Leverage limits

Long and Short limits are automatic by default and remain collapsed when unused. Each side can be independently restricted to:

- **50% LTV** only; or
- the complete product set through **75% LTV**.

Restricting a side to 50% LTV removes both 75% products for that side. Cashback policy then determines whether `75% LTV Cashback` is allowed among otherwise eligible products.

### Adverse-side breakeven

An optional recovery constraint can require the combined portfolio to regain breakeven within the configured adverse-side horizon. When enabled, the optimiser may use the smallest necessary risk relaxation and reports the effective limit.

### Settings

Settings expose the analysis-range bounds, optimiser resolution, default drawdown, recovery horizons, and display asset name. The optimiser uses deterministic refinement down to the selected final resolution.

---

## Reading the output

### Strategy Response

The main chart plots the **V4 strategy combined** position against the underlying asset move.

Depending on the active mode and visibility controls, it can also show:

- the independent Long component as a dotted orange curve;
- the independent Short component as a dotted yellow curve;
- spot;
- Lending Position;
- Perp Position;
- comparator liquidation boundaries; and
- the drawdown limit.

Long and Short component checkboxes independently control those reference curves. They remain separate because the strategy contains two positions whose risks cannot always be understood from the combined curve alone.

When Cashback is active, the chart tooltip breaks the combined V4 value into:

- value and P/L still inside V4; and
- the current cash or spot-asset Cashback value and its P/L.

The **PEA-NILE Enhancement** control expands the same live chart into a focused analytical view without changing its data or settings.

![PEA-NILE Enhancement Mode showing an expanded Strategy Response chart](docs/screenshots/pea-nile-enhancement-mode.png)

### Scenario Analysis

Shows exact V4 values and returns at fixed underlying-price moves. It also reports V4 edge against spot and, in Lending Position or Perp Position mode, V4 edge against the active position comparator.

Lending and perp rows display `RIP` once their supplied liquidation boundary has been reached.

### Position Breakdown

Shows:

- Long and Short capital;
- the selected LTV product for each side;
- external Cashback as cash or spot-asset quantity plus current dollar value; and
- additional capital retained inside V4 by the 75% LTV product.

### Analytical panel

The analytical panel includes Position Breakdown and max-leg drawdown, followed by objective-specific information such as:

- Downside Recovery;
- Protection at Parity;
- Lending or Perp benchmark protection;
- Benchmark Dominance statistics; and
- Product and Routing Decision when applicable.

### Show me the maths

The in-app maths panel displays the normalised Long and Short product equations, portfolio composition, Cashback routing, LTV-to-model mappings, and the assumptions applied to the plotted curves.

---

## Model scope and limitations

This is a static, path-independent price model. All curves are normalised at entry.

The model excludes:

- LP fees and protocol yield;
- borrowing costs;
- perp funding and trading fees;
- slippage;
- time-dependent changes; and
- market-liquidity effects.

### Long model

The 50% LTV Long product tracks the underlying price in the current base model. The 75% products use the calibrated convex V4 curve, with Cashback partitioned once or retained fully inside V4 according to the selected product.

### Short model

The Short curve models continuous rebalancing, including the convex downside response and its intermediate trough. The 50% and 75% products use their respective calibrated model exponents. The same one-time Cashback partition is available on Short.

### Risk and liquidation

V4 legs are modelled without a conventional user-entered liquidation price. Their individual worst points are still measured and constrained by max-leg drawdown.

Lending and Perp comparators retain their supplied liquidation boundaries and are not scored beyond them in relative comparisons.

### Model uncertainty

The model should be updated whenever authoritative V4 documentation contradicts an inferred mechanic. Higher-leverage and Short-side behaviour carry particular uncertainty until complete official formulas and implementation details are public.

---

## Installation and development

V4 Speculator is built with React, TypeScript, Vite, Recharts, and Electron.

### Requirements

- Node.js
- npm

```bash
git clone https://github.com/Scuttl-E/v4-speculator-calculator.git
cd v4-speculator-calculator
npm install
```

Start the Electron development app:

```bash
npm run dev
```

Run tests and create a production build:

```bash
npm test
npm run build
```

Build the Windows package:

```bash
npm run dist:win
```

An experimental macOS package can be attempted on a Mac with `npm run dist:mac`; signing, notarisation, and official macOS distribution are not currently provided.

---

## Project status and disclaimer

V4 Speculator is an experimental research and modelling tool. Its outputs are estimates, not official Peapods Finance calculations, financial advice, or guarantees of real-world strategy performance.

## Licence

Licensed under the [MIT License](LICENSE).
