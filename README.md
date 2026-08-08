# Peapods V4 Price Calculator

Desktop Electron calculator for exploring the supplied two-sided V4 **price-only** payoff model. It intentionally excludes fees, yield, borrow/funding rates, LP fees, liquidations and protocol risk.

## Run

```bash
npm install
npm run dev
```

## Verify and package

```bash
npm test
npm run build
npm run package
```

The model maths lives in `src/model/`. Long 75% LTV and Short 50% LTV are anchored to the supplied curves; all other LTV points are visibly labelled as extrapolations.
