// Sampling defaults and warnings (0.20.0, pure; tested in core/test/v020.test.ts).
// The 0.19 review found Temperature at 2.00, the top of the slider, with nothing saying that is unusual:
// replies rambled and the model thought for 145 s. 0.7 is the default; above 1.2 most models drift.

export const DEFAULT_TEMPERATURE = 0.7;
export const HIGH_TEMPERATURE = 1.2;
/** A saved temperature this high is almost always the slider pushed to the end by accident. */
const RUNAWAY = 1.95;

/** A warning for the Temperature slider, or null when the value is ordinary. */
export function temperatureWarning(t: number): string | null {
  if (!(t > HIGH_TEMPERATURE)) return null;
  return t >= RUNAWAY
    ? 'Very high: replies will ramble, drift off topic and can take much longer. 0.7 suits most chats.'
    : 'High: replies get more random and may drift off topic. 0.7 suits most chats.';
}

/**
 * Once, on the first start of 0.20.0: a temperature left at the slider's maximum goes back to the
 * default. Returns the value to keep (unchanged when there is nothing to fix or this already ran).
 */
export function fixSavedTemperature(t: number | undefined, alreadyFixed: boolean): number | undefined {
  if (alreadyFixed || typeof t !== 'number' || !(t >= RUNAWAY)) return t;
  return DEFAULT_TEMPERATURE;
}
