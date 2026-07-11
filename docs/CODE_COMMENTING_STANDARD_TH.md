# มาตรฐานคอมเมนต์ภาษาไทยของโปรเจกต์ MKT

## เป้าหมาย

ทำให้ผู้พัฒนาอ่าน Flow, Contract, เหตุผล และจุดเสี่ยงได้จาก Source code โดยไม่ต้องเดาจาก Implementation เพียงอย่างเดียว

## กฎบังคับ

1. ทุก Module ต้องมีคำอธิบายหน้าที่และขอบเขตเมื่อชื่อไฟล์อย่างเดียวไม่เพียงพอ
2. ทุก Exported function/class และ Function ที่มี Logic ต้องมีคอมเมนต์ภาษาไทย
3. Function ที่รับ Input ซับซ้อนต้องอธิบาย Parameter, Return และ Error condition
4. Logic สำคัญด้าน Stable key, Idempotency, Retry, Pagination, Rate limit, Date/Timezone, Serialization, Dev/Production และ Security ต้องอธิบายเหตุผล ไม่ใช่เพียงบอกว่าโค้ดทำอะไร
5. Constant/Regex/Threshold ที่มีผลต่อ Business contract หรือ Performance ต้องมีคำอธิบาย
6. Compatibility fallback และ Workaround ต้องบอกเหตุผลและเงื่อนไขที่จะลบได้
7. ห้ามใส่ Token, Secret, Password หรือข้อมูลลูกค้าลับในคอมเมนต์

## รูปแบบที่ใช้

```js
/**
 * อธิบายหน้าที่ของฟังก์ชัน เหตุผล และผลกระทบสำคัญ
 * @param {Object} input ความหมายของข้อมูลเข้า
 * @returns {Readonly<Object>} ความหมายของผลลัพธ์
 */
function example(input) {
  // อธิบาย Block ที่มีเงื่อนไขหรือความเสี่ยง ซึ่งชื่อ Variable อย่างเดียวไม่บอกเหตุผล
}
```

## สิ่งที่ไม่ทำ

ไม่ใส่คอมเมนต์ซ้ำไวยากรณ์ทุกบรรทัด เช่น `count += 1` แล้วเขียนว่า “เพิ่ม count หนึ่ง” เพราะทำให้ไฟล์บวมและคอมเมนต์ล้าสมัยง่าย แต่ทุกบรรทัด/Block ที่มีความหมายทางธุรกิจ, Contract, Side effect หรือความเสี่ยงต้องมีบริบทภาษาไทยครบ

## Definition of Done

ก่อน Release ต้องตรวจว่า Function ใหม่ทุกตัวและ Logic เสี่ยงมีคอมเมนต์ภาษาไทย และ `npm run check`/Tests ยังผ่านหลังแก้คอมเมนต์หรือ Refactor
