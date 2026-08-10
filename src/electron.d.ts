export {};

declare global {
  interface Window {
    desktopWindow?: {
      close: () => void;
      loadInputs: () => Promise<unknown>;
      saveInputs: (inputs: unknown) => Promise<void>;
      openExternal: (target: string) => Promise<void>;
    };
  }
}
