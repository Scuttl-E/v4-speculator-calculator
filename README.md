# V4 Speculator / Price Model

An independent Windows desktop modelling and optimisation tool for exploring potential Peapods Finance V4 strategy behaviour across different underlying asset price moves.

V4 Speculator lets you model Long V4 and Short V4 allocations, leverage, cashback treatment, and drawdown constraints, then compare the resulting response curve against spot, leveraged lending positions, and perpetual futures.

> [!IMPORTANT]
> ## Unofficial V4 model
>
> This project is **independent and unofficial**. It is not produced by, affiliated with, or endorsed by the Peapods Finance team.
>
> The V4 calculations are **close estimates reconstructed from publicly released information**, including Peapods Finance charts, published strategy examples, posts, and technical material made available so far.
>
> Some parts of the model are strongly anchored to published examples, while others necessarily involve interpolation or extrapolation where complete V4 mechanics have not yet been publicly documented.
>
> Treat all figures as **scenario estimates rather than authoritative V4 outputs** until the official Peapods team publishes complete documentation, formulas, and implementation details.
>
> In particular, arbitrary-LTV behaviour and parts of the short-side model involve inferred behaviour beyond the publicly demonstrated anchor points.

---

## What it does

V4 Speculator models how a V4 position could respond as the underlying asset moves through a user-defined price range.

It can:

- combine Long V4 and Short V4 positions;
- model leverage up to the currently supported V4 range;
- account for the modelled V4 cashback structure;
- compare holding cashback as cash with reinvesting it into the underlying asset;
- constrain strategies by maximum drawdown and optional leverage limits;
- optimise allocations, leverage, and cashback treatment for different objectives;
- compare V4 against spot, leveraged lending positions, and perpetual futures;
- model lending and perp liquidation boundaries;
- show scenario returns across a range of asset-price moves;
- analyse breakeven, downside recovery, cashback switch points, parity protection, and benchmark dominance; and
- expand the Strategy Response chart into an immersive PEA-NILE analytical view.

The aim is not to predict the price of an asset. The app asks a different question:

**Given a range of possible prices, what kind of V4 configuration produces the risk/return profile you actually want?**

---

## Comparison modes

The app has three main comparison modes.

### Base

The standard V4 modelling environment.

Use Base when you want to explore V4 on its own or compare it directly against simply holding the underlying asset.

Typical uses include:

- designing a bullish or bearish V4 strategy;
- balancing Long V4 and Short V4;
- constraining maximum drawdown;
- comparing V4 with spot;
- testing cashback treatment; and
- finding configurations that perform well across a broad price range.

This is the simplest mode when there is no existing leveraged position to reproduce or replace.

![Base mode showing the V4 strategy response against spot](docs/screenshots/base-mode.png)

*Base mode — optimise a standalone V4 allocation and inspect its response against holding the underlying asset.*

### Lending Position

Models an existing collateralised lending position alongside V4.

Inputs describe the lending position, including:

- underlying asset amount;
- current asset price;
- USD debt; and
- liquidation LTV.

From these values, the app derives collateral value, net equity, current LTV, liquidation price, and liquidation asset move.

The **net equity** of the lending position becomes the equivalent capital available to the V4 strategy, allowing a like-for-like comparison.

This mode is useful for questions such as:

- Can V4 reproduce the upside of my leveraged lending position with less downside?
- What does V4 look like at the point where my lending position would liquidate?
- Can V4 maintain parity with the lending position at my target price?
- Which strategy has the stronger return profile over the full valid price range?

The lending comparator stops at its liquidation boundary rather than being treated as a zero-value position beyond liquidation.

![Lending Position mode comparing V4 with a collateralised lending position](docs/screenshots/lending-position-mode.png)

*Lending Position mode — compare V4 with collateral, debt, and the supplied lending-liquidation boundary.*

### Perp Position

Compares V4 against an existing linear perpetual-futures position.

The perp comparator uses:

- current or mark price;
- average entry price;
- position side and size;
- margin or collateral;
- current unrealised PnL; and
- a user-supplied liquidation price.

The app derives the perp's current equity from its margin and unrealised PnL. That current equity becomes the equivalent V4 deposit, answering a like-for-like question: what happens if the position is closed now and its available equity is redeployed into V4?

Liquidation is treated as a hard boundary using the supplied exchange liquidation price. The app does not attempt to recreate venue-specific liquidation mechanics.

This mode is useful for questions such as:

- How much of the perp's upside can V4 reproduce?
- What does V4 retain at the point where the perp would liquidate?
- Can V4 match a perp at a target while reducing downside?
- How consistently does V4 outperform the perp before liquidation?

Funding, trading fees, and other time-dependent perp costs are currently outside the base price model.

![Perp Position mode comparing V4 with a perpetual futures position](docs/screenshots/perp-position-mode.png)

*Perp Position mode — compare V4 with an existing perp’s current equity, directional exposure, and supplied liquidation price.*

---

## Optimiser

Manual mode lets you choose the configuration yourself.

**Optimise** searches the available Long V4 and Short V4 allocation, leverage, and cashback choices to find a configuration suited to a particular objective while respecting the selected constraints.

The shipped default configurations include precomputed example results for each valid mode/objective combination, so first-time users can inspect the response curves immediately. For any changed setting, optimisation runs only when explicitly requested; changing a relevant input marks the displayed result as stale rather than silently recalculating it.

### Maximise Bullish Exposure

Optimises for the strongest V4 payoff at a selected **positive underlying price target**.

Maximum Drawdown acts as the main risk constraint. Rather than simply choosing 100% maximum-leverage Long V4, the optimiser may introduce Short V4 exposure, lower leverage, or alter cashback treatment if doing so produces the best feasible result.

In simple terms:

**Get as much upside as possible without exceeding the downside limit you set.**

The Bullish analysis can also identify the **Cashback Switch Point** where holding cashback as cash versus reinvesting it into spot becomes the more efficient configuration as permitted drawdown changes.

### Maximise Bearish Exposure

Optimises for the strongest V4 payoff at a selected **negative underlying price target**, subject to the active risk constraints.

Because the short-side V4 response can be convex, the worst point of the strategy does not necessarily occur at the most extreme asset decline. A strategy may fall into an intermediate trough and then recover strongly as the underlying continues lower.

The **Downside Recovery** analysis shows:

- where that trough occurs;
- the V4 return at the trough;
- the selected bearish target;
- the return reached at that target; and
- the total recovery between the two.

In simple terms:

**Optimise for a major downside move while showing the intermediate pain required to reach the resulting tail payoff.**

### Spot Parity / Protection

Finds a V4 configuration that meets or exceeds the spot position at the selected target while seeking better protection elsewhere.

The resulting analysis compares:

- V4 return at the parity target;
- spot return at the same target;
- parity margin;
- V4 maximum drawdown;
- spot maximum drawdown; and
- protection gained.

In simple terms:

**Keep the target performance of spot while trying to improve the downside profile.**

### Lending Position Parity

Available in Lending Position mode.

The optimiser searches for a V4 configuration that meets or exceeds the lending position at the selected target while improving its risk characteristics where possible. The analysis also shows the V4 position at the lending position's liquidation level.

In simple terms:

**Match the leveraged lending position where you care about its return, then see what protection V4 can provide around the rest of the curve.**

### Perp Position Parity

Available in Perp Position mode.

Works on the same principle as Lending Position Parity, but uses the perpetual-futures position as the target comparator. The analysis compares V4 and the perp at the parity target and shows the V4 position at the perp's supplied liquidation level.

In simple terms:

**Match the perp where you want the exposure while comparing what survives when the perp reaches liquidation.**

### Benchmark Dominance

Benchmark Dominance is a different kind of optimisation.

Instead of optimising for one selected target, it evaluates V4 against the relevant comparator **across the entire valid tested price range**.

The comparator is:

- **Base:** Spot
- **Lending Position:** Lending position
- **Perp Position:** Perp position

At every tested price:

```text
Edge = V4 return - benchmark return
```

For every candidate V4 configuration, the optimiser finds its **worst edge** anywhere in the tested range. It then searches for the configuration that makes that worst result as strong as possible.

If several configurations have effectively the same worst edge, the optimiser prefers:

1. the higher average edge;
2. then the lower maximum drawdown.

For lending and perp comparisons, the tested range ends at liquidation. The model never treats a liquidated comparator as suddenly being worth zero and then continues scoring V4 against it.

The resulting analysis shows:

- the effective tested range;
- the worst V4 edge over the comparator;
- where that weakest point occurs;
- how much of the tested range V4 outperforms the comparator across; and
- average V4 edge across the range.

In simple terms:

**Rather than asking V4 to win at one particular price, make its weakest performance against the benchmark as strong as possible across the whole usable range.**

---

## Risk and strategy controls

### Maximum Drawdown

Sets the maximum portfolio drawdown the optimiser is allowed to accept.

The control supports **0.1 percentage-point increments**, allowing calculated thresholds such as `-46.6%` to be used directly without changing the optimiser's underlying global search resolution.

### Leverage Limits

Long and Short V4 leverage can be left on automatic limits or restricted independently.

The current model supports the V4 leverage range up to:

- **80% LTV**
- **2.50× modelled exposure**

The optimiser can independently select Long and Short leverage within the permitted limits.

### Cashback

The current model assumes the publicly demonstrated V4 structure in which **50% of the supplied amount is returned as cashback while the supplied capital remains deployed**.

Cashback can be modelled as:

#### Hold as cash

Cashback remains fixed and acts as additional downside ballast.

#### Reinvest in spot

Cashback is used to purchase the underlying asset, increasing directional exposure.

#### Auto

In Optimise mode, the optimiser may select whichever of the two existing treatments produces the stronger feasible result for the chosen objective and constraints.

---

## Reading the output

### Strategy Response

The main chart shows portfolio return against movement in the underlying asset.

Depending on the selected mode and controls, it can display:

- combined V4 strategy;
- Long V4;
- Short V4;
- spot;
- Lending Position;
- Perp Position;
- liquidation boundaries; and
- drawdown limits.

The **PEA-NILE Enhancement** toolbar control expands this same live chart into an immersive analytical view without changing the underlying result or chart settings.

### Scenario Analysis

Shows exact values at a selection of underlying asset moves, allowing the V4 strategy and comparator to be inspected numerically rather than only visually.

### Position Breakdown

Shows the modelled capital allocation between:

- Long V4;
- Short V4;
- cashback treatment; and
- selected leverage.

### Objective-specific analysis

The bottom-right analysis changes according to the optimiser objective.

Examples include:

- **Cashback Switch Point** for Bullish optimisation;
- **Downside Recovery** for Bearish optimisation;
- **Protection at Parity** for Spot;
- **Benchmark Protection** for Lending and Perp parity; and
- **Benchmark Dominance** statistics for full-range comparison.

---

## Installation and distribution

V4 Speculator is a Windows-first Electron application built with React, TypeScript, Vite, Recharts, and Electron.

### Windows

A prebuilt Windows installer will be published through GitHub Releases. No release asset is available until the first release is created.

### Source / development

#### Requirements

- Node.js
- npm

Clone the repository:

```bash
git clone <REPOSITORY_URL>
cd <REPOSITORY_DIRECTORY>
```

Install dependencies:

```bash
npm install
```

Start the development application:

```bash
npm run dev
```

Run the model and optimiser tests:

```bash
npm test
```

Create a production build:

```bash
npm run build
```

Build the Windows installer:

```bash
npm run dist
```

The explicit Windows packaging command is:

```bash
npm run dist:win
```

### macOS

No official prebuilt macOS release is currently provided. macOS source-build compatibility is experimental and unverified until the application is tested on a Mac.

On macOS, users may clone the repository, install dependencies, and run the development application with the same source commands above. A local macOS package can be attempted on a Mac with:

```bash
npm run dist:mac
```

This project does not currently provide macOS signing, notarisation, or a polished public macOS binary distribution.

---

## Model assumptions and limitations

This is currently a **base price model**.

Unless specifically implemented elsewhere, outputs exclude effects such as:

- LP fee income;
- protocol yield;
- borrowing costs;
- perp funding;
- trading fees;
- slippage;
- time-dependent changes; and
- market liquidity.

The purpose is to isolate the shape of the modelled V4 payoff and compare it against alternative exposures.

### V4 long side

The published 75% LTV V4 long examples provide a strong anchor for the current long-side model, including publicly shown payoff behaviour and technical material describing the underlying convex payoff.

Behaviour at other LTV levels is modelled from that anchor and should be treated as estimated until complete official mechanics are available.

### V4 short side

The public 50% LTV SuperUSDC example provides the main short-side anchor.

Behaviour at higher leverage levels is extrapolated from that observed relationship and therefore carries greater modelling uncertainty.

### Liquidation

Public V4 material describes the strategy as continuously rebalanced without a conventional liquidation price. V4 Speculator models it accordingly.

Lending and Perp comparators retain their own user-supplied liquidation boundaries and are not evaluated beyond those boundaries when doing relative comparisons.

---

## Project status

V4 Speculator is an experimental modelling and research tool.

The application and underlying V4 approximation will continue to change as:

- additional public V4 information becomes available;
- official documentation is released; and
- model assumptions can be verified or replaced with exact mechanics.

If official V4 documentation conflicts with any current inferred behaviour, the model should be updated to follow the authoritative implementation.

---

## Disclaimer

This project is intended for research, modelling, and experimentation.

Its V4 outputs are estimates based on currently available public information. They should not be treated as official Peapods Finance calculations, financial advice, or guarantees of real-world strategy performance.

---

## Licence

This project is licensed under the [MIT License](LICENSE).
