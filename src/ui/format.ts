const PREFIXES: Array<[number, string]> = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
];

/** Formats a quantity with an SI prefix and three significant figures: 12500, "J" -> "12.5 kJ". */
export function si(value: number, unit: string): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return `- ${unit}`;
  for (const [factor, prefix] of PREFIXES) {
    if (abs >= factor) return `${(value / factor).toPrecision(3)} ${prefix}${unit}`;
  }
  if (abs < 0.005) return `0 ${unit}`;
  return `${abs < 100 ? value.toFixed(2) : value.toFixed(0)} ${unit}`;
}

export function fixed(value: number, digits = 2): string {
  const v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return v.toFixed(digits);
}

/** Mass in kg, switching to tonnes from 1000 kg. */
export function mass(kg: number): string {
  return kg >= 1000 ? `${(kg / 1000).toPrecision(3)} t` : `${kg < 100 ? kg.toFixed(1) : kg.toFixed(0)} kg`;
}
