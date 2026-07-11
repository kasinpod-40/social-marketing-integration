import { toFiniteNumber } from '../../../shared/src/number/strict-number.js';

/**
 * แปลง Metric ที่อาจว่างให้เป็น number หรือ null
 * คงค่า 0 ไว้เพราะ 0 เป็นข้อมูลจริง ไม่ใช่ค่า Missing
 */
export function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  return toFiniteNumber(value, { label: 'numeric metric' });
}

/**
 * คำนวณอัตราส่วน numerator/denominator
 * คืน null เมื่อไม่มีตัวตั้ง/ตัวหารหรือ denominator ไม่มากกว่า 0 เพื่อหลีกเลี่ยง Infinity/NaN
 */
export function calculateRate(numerator, denominator) {
  const safeNumerator = nullableNumber(numerator);
  const safeDenominator = nullableNumber(denominator);

  if (safeNumerator === null || safeDenominator === null || safeDenominator <= 0) return null;
  return safeNumerator / safeDenominator;
}

/** คำนวณ Actual ROAS จาก conversion value จริงหารด้วย spend จริง */
export function calculateRoas({ spend, conversionValue }) {
  const safeSpend = nullableNumber(spend);
  const safeValue = nullableNumber(conversionValue);

  if (safeSpend === null || safeValue === null || safeSpend <= 0) return null;
  return safeValue / safeSpend;
}

/** คำนวณ Cost per Acquisition โดยใช้ Contract เดียวกับ calculateRate */
export function calculateCpa({ spend, conversions }) {
  return calculateRate(spend, conversions);
}
