export function nullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new TypeError(`Invalid numeric metric value: ${value}`);
  }

  return numericValue;
}

export function calculateRate(numerator, denominator) {
  const safeNumerator = nullableNumber(numerator);
  const safeDenominator = nullableNumber(denominator);

  if (safeNumerator === null || safeDenominator === null || safeDenominator <= 0) {
    return null;
  }

  return safeNumerator / safeDenominator;
}

export function calculateRoas({ spend, conversionValue }) {
  const safeSpend = nullableNumber(spend);
  const safeValue = nullableNumber(conversionValue);

  if (safeSpend === null || safeValue === null || safeSpend <= 0) {
    return null;
  }

  return safeValue / safeSpend;
}

export function calculateCpa({ spend, conversions }) {
  return calculateRate(spend, conversions);
}
