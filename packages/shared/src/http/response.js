/**
 * สร้าง HTTP JSON Response มาตรฐานของ Worker
 * Header ที่ผู้เรียกส่งมาจะถูกรักษาไว้ แต่ content-type ถูกบังคับให้เป็น UTF-8 JSON เสมอ
 */
export function json(body, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set('content-type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}
