const BROWSER_STORAGE_KEY = "v4-speculator-calculator:inputs";
let saveQueue = Promise.resolve();

export const isDesktopShell = () => Boolean(window.desktopWindow);

export async function loadCalculatorInputs(): Promise<unknown> {
  const loadInputs = window.desktopWindow?.loadInputs;
  if (loadInputs) return loadInputs();

  try {
    const stored = window.localStorage.getItem(BROWSER_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

async function writeCalculatorInputs(inputs: unknown): Promise<void> {
  const saveInputs = window.desktopWindow?.saveInputs;
  if (saveInputs) return saveInputs(inputs);

  try {
    window.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

export function saveCalculatorInputs(inputs: unknown): Promise<void> {
  const save = saveQueue.catch(() => undefined).then(() => writeCalculatorInputs(inputs));
  saveQueue = save;
  return save;
}
