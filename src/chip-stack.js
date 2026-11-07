export const CHIP_DENOMINATIONS = [
  { value: 100, color: "#eee8dc", label: "$1" },
  { value: 500, color: "#a9112e", label: "$5" },
  { value: 2500, color: "#087342", label: "$25" },
  { value: 10000, color: "#111722", label: "$100" },
  { value: 50000, color: "#6d36a5", label: "$500" },
  { value: 100000, color: "#c28b0c", label: "$1,000" },
];

export function chipDenomination(value) {
  return (
    [...CHIP_DENOMINATIONS].reverse().find((d) => value >= d.value) ||
    CHIP_DENOMINATIONS[0]
  );
}

// A finite display stack, with its exact total shown separately by the caller.
export function chipStackForAmount(amount, limit = 8) {
  let remainder = Math.max(0, amount);
  const chips = [];
  for (const { value } of [...CHIP_DENOMINATIONS].reverse()) {
    while (remainder >= value && chips.length < limit) {
      chips.push(value);
      remainder -= value;
    }
  }
  if (!chips.length && amount > 0) chips.push(100);
  return { chips, truncated: remainder > 0, total: amount };
}
