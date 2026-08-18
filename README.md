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
- model the `2x`, `2x Cashback`, and `2.5x` products on either side;
- route Cashback to fixed cash or a spot-asset holding;
- let the optimiser exclude, require, or automatically assess Cashback products;
- constrain Long and Short products independently to `2x` only or the complete product set through `2.5x`;
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

Harvester is an interactive, chart-led workspace for planning V4 cash withdrawals while preserving final benchmark parity. It keeps independent Long-side and Short-side planning sessions, so a downside withdrawal plan never replaces your upside plan.

Choose the harvesting direction and a final target, then fine-tune checkpoints or choose an automated plan to see the cash you can extract while retaining equivalent benchmark exposure at that target.

Use it to:

- build a custom withdrawal schedule by adding, moving, and editing checkpoints directly on the chart;
- compare it with **Max Harvest Rate**, **Max Equal Harvest**, and **Fastest Capital Recovery** plans;
- maintain separate Long and Short schedules, targets, checkpoints, recovery settings, and undo history;
- choose whether each withdrawal comes from both V4 legs proportionally, the Long leg first, or the Short leg first;
- adjust the target, benchmark, interval, checkpoint count, and first checkpoint;
- inspect each checkpoint's withdrawal, remaining V4 value, and component balance;
- use **Complete** chart view to inspect both sides of entry at once, set Short and Long chart bounds, and preview the state before, through, or after selected cashout stages;
- toggle individual chart series from the legend and use the detailed hover tooltip to inspect Long and Short component values; and
- review a selected analysis point's harvested cash, remaining active V4, Cashback value, total wealth, benchmark surplus or shortfall, and capital coverage.

Capital recovery can include or exclude initial Cashback. When Cashback is held as the spot asset, Harvester values it at the relevant price move and treats recovery as complete only when coverage remains durable through the final target.

Harvester is a separate planning workspace: opening, editing, or closing it does not alter the calculator's underlying V4 configuration.

---

## V4 products

Long and Short positions can each use the same three configurations. The simplest way to understand their formation is by looking at how much gross V4 exposure is created from the starting capital, and whether the additional gross `0.5x` is returned as Cashback or kept working inside V4.

At a high level, V4 combines the capital supplied by the user with borrowed capital to create the two sides of an LP position. The leverage factor compares that gross position with the user's starting capital. It describes position formation, not a direct multiplier applied to returns.

### 2x

`2x` is the standard V4 position. The user's starting capital supplies one side of the LP and the protocol effectively borrows the paired side needed to create the position. The full starting capital remains committed to V4 and no Cashback is taken out.

**Example:** `$10,000 starting capital → $20,000 gross V4 exposure`

The position therefore has a `2x` leverage factor: twice as much gross exposure as the capital supplied by the user.

### 2x Cashback

`2x Cashback` uses the higher-leverage configuration to keep a structural V4 position working while returning the additional value made available by that configuration to the user as Cashback. Its complete payoff curve is not identical to the standalone `2x` product.

In the calculator, that Cashback equals 50% of the starting deposit. It can remain as cash or be used to buy the underlying spot asset.

**Example:** `$10,000 starting capital → $20,000 gross V4 exposure + $5,000 Cashback`

Cash routing keeps the Cashback value fixed after entry. Spot routing gives that Cashback continuing exposure to changes in the underlying asset price.

We suspect `2x Cashback` is the configuration Peapods refers to as the **Super Strategy**: its public examples describe superlinear returns together with 50% Cashback on entry, and the published scenario values align with this calculator's model.

The Cashback is created once. It is not recursively reinvested, multiplied again, or counted both inside and outside V4.

### 2.5x

`2.5x` uses the same additional gross `0.5x` inside the V4 position instead of returning it as Cashback. This increases the gross working position and leaves no external Cashback.

**Example:** `$10,000 starting capital → $25,000 gross V4 exposure`

The complete `2.5x` exposure remains working inside V4.

Gross exposure is not additional net wealth. Borrowed financing and the position's internal liabilities offset its gross assets, and every modelled product is normalised to the original deposit at entry. In the `$10,000` Cashback example, total modelled wealth at entry remains `$10,000`: `$5,000` is external Cashback and `$5,000` is the net value still inside V4, even though the gross working exposure is larger. For `2.5x`, the complete `$10,000` of net entry value remains inside V4.

### The key difference

`2x Cashback` and `2.5x` are two different uses of the additional gross `0.5x` made available during position formation:

- `2x Cashback` returns it to the user; and
- `2.5x` keeps it working inside V4.

It is never used in both places at once.

### How the calculator models the result

The exposure examples above explain how the positions are formed. The chart then uses normalised payoff equations to estimate their gross structural value at each price ratio. This is a frictionless state model of the response attributed to ideal rebalancing; it does not simulate the path taken between entry and the selected price.

Let:

- `p = current asset price ÷ entry asset price`; and
- `R(p) = 1` when Cashback remains cash, or `R(p) = p` when Cashback is routed to spot.

The product formation leverage factor is:

`LF = 1 + 2 × LTV`

`LF` labels gross position formation and is not substituted into the payoff equations as a return multiplier.

The Long values are modelled as:

- `2x: p`
- `2x Cashback: 0.5p² + 0.5R(p)`
- `2.5x: p²`

The Short model uses the inverse-exposure parameter:

`m = 0.5 ÷ (1 - Short LTV)`

This gives `m = 1` for the modelled `2x` Short and `m = 2` for the structural curve used by `2x Cashback` and `2.5x`. The parameter `m` is not an exponent: it scales the inverse-price sleeve in the Short equation.

The Short model uses the rebalanced curve:

`Sₘ(p) = 0.5 + 0.5p + 0.5m ÷ p - 0.5m`

Equivalently:

`Sₘ(p) = 0.5p + 0.5m ÷ p + 0.5(1 - m)`

This decomposition shows the modelled positive-price sleeve, the inverse-price sleeve scaled by `m`, and the cash or borrowing adjustment that normalises the curve to `1.00` at entry.

The Short values are modelled as:

- `2x: Sₘ₌₁(p)`
- `2x Cashback: 0.5Sₘ₌₂(p) + 0.5R(p)`
- `2.5x: Sₘ₌₂(p)`

`Short` identifies the inverse/rebalanced product family rather than guaranteeing that the complete routed position has negative directional exposure at every price. In particular, converting Cashback to spot can offset part or all of the structural Short exposure.

If `a` is the proportion of starting capital allocated to Long, the combined normalised position is:

`V(p) = aL(p) + (1 - a)S(p)`

The calculator reports `deposit × V(p)` as total modelled structural wealth before the excluded yield and costs. Any Cashback component is tracked separately from the net value still working inside V4 while remaining part of total wealth; gross borrowed exposure is not added again.

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

- **Off:** exclude `2x Cashback` from both sides;
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

- **2x** only; or
- the complete product set through **2.5x**.

Restricting a side to `2x` removes both `2x Cashback` and `2.5x` for that side. Cashback policy then determines whether `2x Cashback` is allowed among otherwise eligible products.

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
- the selected product for each side;
- external Cashback as cash or spot-asset quantity plus current dollar value; and
- additional capital retained inside V4 by the `2.5x` product.

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

This is a gross, frictionless and path-independent state model. It evaluates structural value at each price ratio under the assumption that the selected product's target exposure is ideally maintained through rebalancing. It does not simulate individual rebalances or the realised journey to that price. All curves are normalised at entry.

The model excludes:

- LP fees and protocol yield;
- borrowing costs;
- perp funding and trading fees;
- rebalancing execution costs;
- slippage;
- time-dependent changes; and
- market-liquidity effects.

Outputs are therefore not net realised returns. The calculator deliberately separates the structural price curve from the question of whether volatility-farming yield outweighs borrowing, funding and maintenance costs.

### Long model

The `2x` Long product tracks the underlying price in the current base model. `2x Cashback` and `2.5x` use the calibrated convex V4 curve, with Cashback partitioned once or retained fully inside V4 according to the selected product.

### Short model

The Short equation approximates the gross structural response attributed to ideal rebalancing. It combines a positive-price sleeve with an inverse-price sleeve controlled by `m`, producing a convex curve whose directional exposure and trough depend on the selected product and Cashback route. The `2x` product uses `m = 1`; `2x Cashback` partitions the modelled `m = 2` structural curve once; and `2.5x` retains the complete `m = 2` curve inside V4. The calculation does not simulate the rebalancing path or its associated yield and costs.

### Risk and liquidation

V4 legs are modelled without a conventional user-entered liquidation price. Max-leg drawdown measures the worst allocation-weighted loss contribution from each active structural leg, excluding external Cashback, so profit in the opposing leg or held Cashback cannot conceal structural loss.

Lending and Perp comparators retain their supplied liquidation boundaries and are not scored beyond them in relative comparisons.

### Model uncertainty

The model should be updated whenever authoritative V4 documentation contradicts an inferred mechanic. Higher-leverage and Short-side behaviour carry particular uncertainty until complete official formulas and implementation details are public. The Short equation contains an inverse-price term and therefore grows rapidly as `p` approaches zero; extreme-downside values are extrapolations of the idealised curve and do not include practical liquidity, borrowing-capacity or protocol limits.

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
