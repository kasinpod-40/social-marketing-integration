-- ป้องกัน Incident เดิมที่ Resolve แล้วถูกเปิดซ้ำจาก Retry/duplicate upsert เดิม
-- Alert generation ใหม่ต้องใช้ alert_id ใหม่ หรือมี Explicit reopen workflow แยกต่างหาก

CREATE TRIGGER IF NOT EXISTS trg_system_alerts_preserve_resolved_status
AFTER UPDATE OF status ON system_alerts
WHEN OLD.status = 'resolved' AND NEW.status = 'open'
BEGIN
  UPDATE system_alerts
  SET status = 'resolved'
  WHERE alert_id = NEW.alert_id;
END;
