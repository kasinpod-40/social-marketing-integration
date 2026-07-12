import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { larkFieldTypeAllowsProperty, normalizeLarkFieldProperty } from '../../shared/src/lark/lark-field-contract.js';

/**
 * Contract ของ Report Schema ที่ใช้ร่วมกันระหว่าง Preview, Apply และ Tests
 * เก็บเฉพาะโครงสร้าง Non-secret; Table IDs จริงอ่านจาก Environment ของแต่ละ Base
 */
export const LARK_REPORT_SCHEMA_VERSION = 'report-schema-v1.1';

export const LARK_REPORT_SCHEMA = deepFreeze([
  {
    "key": "mktMetricDefinitions",
    "createName": "📐 MKT_Metric_Definitions",
    "aliases": [
      "MKT_Metric_Definitions",
      "📐 MKT_Metric_Definitions"
    ],
    "envName": "LARK_TABLE_MKT_METRIC_DEFINITIONS",
    "defaultViewName": "📋 All Metrics",
    "logicalName": "MKT_Metric_Definitions",
    "fields": [
      {
        "fieldName": "metric_key",
        "type": 1,
        "uiType": "Text",
        "primary": true,
        "description": "รหัส Metric แบบ platform:metric"
      },
      {
        "fieldName": "platform",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "",
        "property": {
          "options": [
            {
              "name": "facebook",
              "color": 0
            },
            {
              "name": "instagram",
              "color": 1
            },
            {
              "name": "tiktok",
              "color": 2
            },
            {
              "name": "youtube",
              "color": 3
            },
            {
              "name": "meta_ads",
              "color": 4
            },
            {
              "name": "tiktok_ads",
              "color": 5
            },
            {
              "name": "google_ads",
              "color": 6
            }
          ]
        }
      },
      {
        "fieldName": "raw_field_name",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "display_name",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "formula",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "unit",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "",
        "property": {
          "options": [
            {
              "name": "count",
              "color": 0
            },
            {
              "name": "percent",
              "color": 1
            },
            {
              "name": "seconds",
              "color": 2
            },
            {
              "name": "currency",
              "color": 3
            },
            {
              "name": "ratio",
              "color": 4
            },
            {
              "name": "text",
              "color": 5
            }
          ]
        }
      },
      {
        "fieldName": "can_compare_cross_platform",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "fallback_metric",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "metric_note",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "enabled",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "เปิด/ปิด Metric โดยไม่แก้โค้ด"
      },
      {
        "fieldName": "metric_scope",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ระดับการคำนวณ",
        "property": {
          "options": [
            {
              "name": "content_snapshot",
              "color": 0
            },
            {
              "name": "content_period",
              "color": 1
            },
            {
              "name": "account_period",
              "color": 2
            },
            {
              "name": "report_quality",
              "color": 3
            }
          ]
        }
      },
      {
        "fieldName": "source_table",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ตารางต้นทางเชิงตรรกะ",
        "property": {
          "options": [
            {
              "name": "MKT_Content",
              "color": 0
            },
            {
              "name": "MKT_Content_Daily",
              "color": 1
            },
            {
              "name": "MKT_Ads_Daily",
              "color": 2
            },
            {
              "name": "derived",
              "color": 3
            }
          ]
        }
      },
      {
        "fieldName": "aggregation_method",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "วิธี Aggregate",
        "property": {
          "options": [
            {
              "name": "sum_delta",
              "color": 0
            },
            {
              "name": "sum_latest",
              "color": 1
            },
            {
              "name": "count_distinct",
              "color": 2
            },
            {
              "name": "weighted_average_latest",
              "color": 3
            },
            {
              "name": "derived_rate",
              "color": 4
            },
            {
              "name": "coverage_ratio",
              "color": 5
            }
          ]
        }
      },
      {
        "fieldName": "null_policy",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "กติกาค่า Null",
        "property": {
          "options": [
            {
              "name": "exclude",
              "color": 0
            },
            {
              "name": "zero",
              "color": 1
            },
            {
              "name": "preserve_null",
              "color": 2
            }
          ]
        }
      },
      {
        "fieldName": "higher_is_better",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "ทิศทางการตีความผล"
      },
      {
        "fieldName": "decimal_places",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "จำนวนทศนิยมที่แสดง",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "formula_version",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "เวอร์ชันสูตร"
      },
      {
        "fieldName": "client_visible",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "แสดงใน Client View"
      },
      {
        "fieldName": "sort_order",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "ลำดับ Metric",
        "property": {
          "formatter": "#,##0"
        }
      }
    ]
  },
  {
    "key": "mktReportSettings",
    "createName": "⚙️ MKT_Report_Settings",
    "aliases": [
      "MKT_Report_Settings",
      "⚙️ MKT_Report_Settings"
    ],
    "envName": "LARK_TABLE_MKT_REPORT_SETTINGS",
    "defaultViewName": "📋 All Report Settings",
    "logicalName": "MKT_Report_Settings",
    "fields": [
      {
        "fieldName": "report_setting_key",
        "type": 1,
        "uiType": "Text",
        "primary": true,
        "description": "รหัส Setting แยกลูกค้า/แพลตฟอร์ม/รอบ"
      },
      {
        "fieldName": "report_name",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "ชื่อรายงาน"
      },
      {
        "fieldName": "period_type",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "รอบรายงาน",
        "property": {
          "options": [
            {
              "name": "daily",
              "color": 0
            },
            {
              "name": "weekly",
              "color": 1
            },
            {
              "name": "monthly",
              "color": 2
            },
            {
              "name": "yearly",
              "color": 3
            }
          ]
        }
      },
      {
        "fieldName": "group_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Lark Group ID ลูกค้า"
      },
      {
        "fieldName": "enabled",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "เปิด Setting"
      },
      {
        "fieldName": "customer_profile",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Customer profile runtime"
      },
      {
        "fieldName": "report_type",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ชนิดรายงาน",
        "property": {
          "options": [
            {
              "name": "daily_organic_report",
              "color": 0
            },
            {
              "name": "weekly_organic_report",
              "color": 1
            }
          ]
        }
      },
      {
        "fieldName": "platforms",
        "type": 4,
        "uiType": "MultiSelect",
        "primary": false,
        "description": "แพลตฟอร์มที่รวม",
        "property": {
          "options": [
            {
              "name": "tiktok",
              "color": 0
            },
            {
              "name": "facebook",
              "color": 1
            },
            {
              "name": "instagram",
              "color": 2
            },
            {
              "name": "youtube",
              "color": 3
            }
          ]
        }
      },
      {
        "fieldName": "account_keys_json",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "บัญชีที่รายงาน v1 รองรับ 1 บัญชี"
      },
      {
        "fieldName": "timezone",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Timezone ธุรกิจ"
      },
      {
        "fieldName": "utc_offset",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Offset สำหรับ DateTime Lark"
      },
      {
        "fieldName": "send_time",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "เวลาส่ง"
      },
      {
        "fieldName": "send_weekday",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ใช้กับ Weekly",
        "property": {
          "options": [
            {
              "name": "monday",
              "color": 0
            },
            {
              "name": "tuesday",
              "color": 1
            },
            {
              "name": "wednesday",
              "color": 2
            },
            {
              "name": "thursday",
              "color": 3
            },
            {
              "name": "friday",
              "color": 4
            },
            {
              "name": "saturday",
              "color": 5
            },
            {
              "name": "sunday",
              "color": 6
            }
          ]
        }
      },
      {
        "fieldName": "comparison_mode",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "วิธีเทียบช่วง",
        "property": {
          "options": [
            {
              "name": "none",
              "color": 0
            },
            {
              "name": "previous_period",
              "color": 1
            }
          ]
        }
      },
      {
        "fieldName": "language",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ภาษารายงาน",
        "property": {
          "options": [
            {
              "name": "th",
              "color": 0
            },
            {
              "name": "en",
              "color": 1
            }
          ]
        }
      },
      {
        "fieldName": "top_content_limit",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "จำนวนอันดับ",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "ai_enabled",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "ข้อ 8 ยังปิด"
      },
      {
        "fieldName": "notification_enabled",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "ข้อ 8 ยังปิด"
      },
      {
        "fieldName": "config_version",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "เวอร์ชัน Contract"
      }
    ]
  },
  {
    "key": "mktReportSnapshots",
    "createName": "🧾 MKT_Report_Snapshots",
    "aliases": [
      "MKT_Report_Snapshots",
      "🧾 MKT_Report_Snapshots"
    ],
    "envName": "LARK_TABLE_MKT_REPORT_SNAPSHOTS",
    "defaultViewName": "📋 All Report Snapshots",
    "logicalName": "MKT_Report_Snapshots",
    "fields": [
      {
        "fieldName": "report_id",
        "type": 1,
        "uiType": "Text",
        "primary": true,
        "description": "รหัส Snapshot คงที่"
      },
      {
        "fieldName": "report_type",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "เพิ่ม Daily option",
        "property": {
          "options": [
            {
              "name": "weekly_organic_report",
              "color": 0
            },
            {
              "name": "monthly_organic_report",
              "color": 1
            },
            {
              "name": "ads_performance_report",
              "color": 2
            },
            {
              "name": "course_campaign_report",
              "color": 3
            },
            {
              "name": "top_content_report",
              "color": 4
            },
            {
              "name": "platform_strength_weakness_report",
              "color": 5
            },
            {
              "name": "executive_summary_report",
              "color": 6
            },
            {
              "name": "yoy_report",
              "color": 7
            },
            {
              "name": "daily_organic_report",
              "color": 8
            }
          ]
        }
      },
      {
        "fieldName": "platform",
        "type": 4,
        "uiType": "MultiSelect",
        "primary": false,
        "description": "",
        "property": {
          "options": [
            {
              "name": "facebook",
              "color": 0
            },
            {
              "name": "instagram",
              "color": 1
            },
            {
              "name": "tiktok",
              "color": 2
            },
            {
              "name": "youtube",
              "color": 3
            },
            {
              "name": "meta_ads",
              "color": 4
            },
            {
              "name": "tiktok_ads",
              "color": 5
            },
            {
              "name": "google_ads",
              "color": 6
            }
          ]
        }
      },
      {
        "fieldName": "period_start",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "period_end",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "compare_start",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "compare_end",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "comparison_mode",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "",
        "property": {
          "options": [
            {
              "name": "none",
              "color": 0
            },
            {
              "name": "previous_period",
              "color": 1
            },
            {
              "name": "year_over_year",
              "color": 2
            },
            {
              "name": "custom_range",
              "color": 3
            }
          ]
        }
      },
      {
        "fieldName": "course_name",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "metric_payload_json",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "top_content_json",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "top_ads_json",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": ""
      },
      {
        "fieldName": "generated_at",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "report_setting_key",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "อ้าง Setting"
      },
      {
        "fieldName": "customer_profile",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "แยกลูกค้า"
      },
      {
        "fieldName": "account_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "แยกบัญชี"
      },
      {
        "fieldName": "data_status",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "คุณภาพข้อมูล",
        "property": {
          "options": [
            {
              "name": "complete",
              "color": 0
            },
            {
              "name": "partial",
              "color": 1
            },
            {
              "name": "no_data",
              "color": 2
            }
          ]
        }
      },
      {
        "fieldName": "formula_version",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "เวอร์ชันสูตร"
      },
      {
        "fieldName": "source_snapshot_count",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "จำนวน Snapshot ที่ใช้",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "baseline_coverage_rate",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "อัตราความครบ Baseline",
        "property": {
          "formatter": "#,##0.0000"
        }
      }
    ]
  },
  {
    "key": "mktReportMetricValues",
    "createName": "📊 MKT_Report_Metric_Values",
    "aliases": [
      "MKT_Report_Metric_Values",
      "📊 MKT_Report_Metric_Values"
    ],
    "envName": "LARK_TABLE_MKT_REPORT_METRIC_VALUES",
    "defaultViewName": "📊 Client Metrics",
    "logicalName": "MKT_Report_Metric_Values",
    "fields": [
      {
        "fieldName": "report_metric_key",
        "type": 1,
        "uiType": "Text",
        "primary": true,
        "description": "รหัส Metric row"
      },
      {
        "fieldName": "report_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "อ้าง Snapshot"
      },
      {
        "fieldName": "report_setting_key",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "อ้าง Setting"
      },
      {
        "fieldName": "customer_profile",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "แยกลูกค้า"
      },
      {
        "fieldName": "report_type",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ชนิดรายงาน",
        "property": {
          "options": [
            {
              "name": "daily_organic_report",
              "color": 0
            },
            {
              "name": "weekly_organic_report",
              "color": 1
            }
          ]
        }
      },
      {
        "fieldName": "platform",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "แพลตฟอร์ม",
        "property": {
          "options": [
            {
              "name": "tiktok",
              "color": 0
            },
            {
              "name": "facebook",
              "color": 1
            },
            {
              "name": "instagram",
              "color": 2
            },
            {
              "name": "youtube",
              "color": 3
            }
          ]
        }
      },
      {
        "fieldName": "account_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "บัญชี"
      },
      {
        "fieldName": "metric_key",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Metric definition key"
      },
      {
        "fieldName": "display_name",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "ชื่อแสดง"
      },
      {
        "fieldName": "current_value",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "ค่าช่วงปัจจุบัน",
        "property": {
          "formatter": "#,##0.0000"
        }
      },
      {
        "fieldName": "compare_value",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "ค่าช่วงเทียบ",
        "property": {
          "formatter": "#,##0.0000"
        }
      },
      {
        "fieldName": "change_value",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "ผลต่าง",
        "property": {
          "formatter": "#,##0.0000"
        }
      },
      {
        "fieldName": "change_percent",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "สัดส่วนเปลี่ยน",
        "property": {
          "formatter": "#,##0.0000"
        }
      },
      {
        "fieldName": "unit",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "หน่วย",
        "property": {
          "options": [
            {
              "name": "count",
              "color": 0
            },
            {
              "name": "percent",
              "color": 1
            },
            {
              "name": "seconds",
              "color": 2
            },
            {
              "name": "currency",
              "color": 3
            },
            {
              "name": "ratio",
              "color": 4
            }
          ]
        }
      },
      {
        "fieldName": "data_status",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "คุณภาพข้อมูล",
        "property": {
          "options": [
            {
              "name": "complete",
              "color": 0
            },
            {
              "name": "partial",
              "color": 1
            },
            {
              "name": "no_data",
              "color": 2
            }
          ]
        }
      },
      {
        "fieldName": "dimension_type",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "มิติ v1",
        "property": {
          "options": [
            {
              "name": "summary",
              "color": 0
            }
          ]
        }
      },
      {
        "fieldName": "dimension_value",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "ค่ามิติ"
      },
      {
        "fieldName": "rank",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "ลำดับแสดง",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "period_start",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "เริ่มช่วง",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "period_end",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "จบช่วง",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "compare_start",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "เริ่มเทียบ",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "compare_end",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "จบเทียบ",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "generated_at",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "เวลาสร้าง",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "formula_version",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "เวอร์ชันสูตร"
      },
      {
        "fieldName": "source_snapshot_count",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "จำนวน Snapshot",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "client_visible",
        "type": 7,
        "uiType": "Checkbox",
        "primary": false,
        "description": "ใช้กรอง Client View"
      }
    ]
  },
  {
    "key": "mktReportTopContent",
    "createName": "🏆 MKT_Report_Top_Content",
    "aliases": [
      "MKT_Report_Top_Content",
      "🏆 MKT_Report_Top_Content"
    ],
    "envName": "LARK_TABLE_MKT_REPORT_TOP_CONTENT",
    "defaultViewName": "🏆 Top Content",
    "logicalName": "MKT_Report_Top_Content",
    "fields": [
      {
        "fieldName": "report_content_key",
        "type": 1,
        "uiType": "Text",
        "primary": true,
        "description": "Fixed rank key"
      },
      {
        "fieldName": "report_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "อ้าง Snapshot"
      },
      {
        "fieldName": "report_setting_key",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "อ้าง Setting"
      },
      {
        "fieldName": "customer_profile",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "แยกลูกค้า"
      },
      {
        "fieldName": "report_type",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "ชนิดรายงาน",
        "property": {
          "options": [
            {
              "name": "daily_organic_report",
              "color": 0
            },
            {
              "name": "weekly_organic_report",
              "color": 1
            }
          ]
        }
      },
      {
        "fieldName": "platform",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "แพลตฟอร์ม",
        "property": {
          "options": [
            {
              "name": "tiktok",
              "color": 0
            }
          ]
        }
      },
      {
        "fieldName": "account_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "บัญชี"
      },
      {
        "fieldName": "rank",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "อันดับ",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "content_key",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Content key"
      },
      {
        "fieldName": "external_content_id",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Video ID"
      },
      {
        "fieldName": "caption",
        "type": 1,
        "uiType": "Text",
        "primary": false,
        "description": "Caption/No data placeholder"
      },
      {
        "fieldName": "content_url",
        "type": 15,
        "uiType": "Url",
        "primary": false,
        "description": "ลิงก์คลิป"
      },
      {
        "fieldName": "thumbnail_url",
        "type": 15,
        "uiType": "Url",
        "primary": false,
        "description": "ภาพ/placeholder"
      },
      {
        "fieldName": "published_at",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "เวลาโพสต์",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "period_views",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "Views เพิ่ม",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "period_likes",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "Likes เพิ่ม",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "period_comments",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "Comments เพิ่ม",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "period_shares",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "Shares เพิ่ม",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "period_engagement",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "Engagement เพิ่ม",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "period_engagement_rate",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "Engagement rate",
        "property": {
          "formatter": "#,##0.0000"
        }
      },
      {
        "fieldName": "latest_total_views",
        "type": 2,
        "uiType": "Number",
        "primary": false,
        "description": "ยอดสะสมล่าสุด",
        "property": {
          "formatter": "#,##0"
        }
      },
      {
        "fieldName": "performance_status",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "สถานะการเติบโต",
        "property": {
          "options": [
            {
              "name": "growing",
              "color": 0
            },
            {
              "name": "stable",
              "color": 1
            },
            {
              "name": "new",
              "color": 2
            },
            {
              "name": "corrected_down",
              "color": 3
            },
            {
              "name": "partial",
              "color": 4
            },
            {
              "name": "no_data",
              "color": 5
            }
          ]
        }
      },
      {
        "fieldName": "data_status",
        "type": 3,
        "uiType": "SingleSelect",
        "primary": false,
        "description": "คุณภาพข้อมูล",
        "property": {
          "options": [
            {
              "name": "complete",
              "color": 0
            },
            {
              "name": "partial",
              "color": 1
            },
            {
              "name": "no_data",
              "color": 2
            }
          ]
        }
      },
      {
        "fieldName": "period_start",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "เริ่มช่วง",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "period_end",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "จบช่วง",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      },
      {
        "fieldName": "generated_at",
        "type": 5,
        "uiType": "DateTime",
        "primary": false,
        "description": "เวลาสร้าง",
        "property": {
          "date_formatter": "yyyy/MM/dd",
          "auto_fill": false
        }
      }
    ]
  }
]);


/** คืน Contract ของตารางตาม Logical key */
export function getReportSchemaTable(tableKey) {
  const table = LARK_REPORT_SCHEMA.find((candidate) => candidate.key === tableKey);
  if (!table) {
    throw permanentError(`Unknown report schema table key: ${tableKey}`, {
      code: 'LARK_REPORT_SCHEMA_INVALID',
      details: { tableKey },
    });
  }
  return table;
}

/** ตรวจ Contract ตอนโหลด Module เพื่อจับชื่อ/Primary/Field ซ้ำก่อนเรียก Lark */
export function validateReportSchemaDefinition(schema = LARK_REPORT_SCHEMA) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new TypeError('Report schema must contain at least one table');
  }

  const tableKeys = new Set();
  for (const table of schema) {
    requireText(table?.key, 'table.key');
    requireText(table?.logicalName, 'table.logicalName');
    requireText(table?.createName, 'table.createName');
    requireText(table?.envName, 'table.envName');
    if (tableKeys.has(table.key)) throw new TypeError(`Duplicate report schema table key: ${table.key}`);
    tableKeys.add(table.key);

    if (!Array.isArray(table.aliases) || table.aliases.length === 0) {
      throw new TypeError(`Report schema table ${table.key} requires aliases`);
    }
    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      throw new TypeError(`Report schema table ${table.key} requires fields`);
    }

    const fieldNames = new Set();
    const primaryFields = table.fields.filter((field) => field.primary === true);
    if (primaryFields.length !== 1) {
      throw new TypeError(`Report schema table ${table.key} requires exactly one primary field`);
    }
    if (table.fields[0].primary !== true) {
      throw new TypeError(`Report schema table ${table.key} must place the primary field first`);
    }

    for (const field of table.fields) {
      requireText(field?.fieldName, `${table.key}.fieldName`);
      if (fieldNames.has(field.fieldName)) {
        throw new TypeError(`Duplicate report schema field ${table.key}.${field.fieldName}`);
      }
      fieldNames.add(field.fieldName);
      if (!Number.isInteger(field.type) || field.type <= 0) {
        throw new TypeError(`Invalid Lark field type for ${table.key}.${field.fieldName}`);
      }
      if (!larkFieldTypeAllowsProperty(field.type) && field.property !== undefined) {
        throw new TypeError(`Lark field property must be omitted for ${table.key}.${field.fieldName}`);
      }
      if (field.property !== undefined) {
        const normalizedProperty = normalizeLarkFieldProperty(field.type, field.property);
        if (!normalizedProperty) {
          throw new TypeError(`Lark field property is empty or unsupported for ${table.key}.${field.fieldName}`);
        }
        const rawKeys = Object.keys(field.property).sort();
        const normalizedKeys = Object.keys(normalizedProperty).sort();
        if (rawKeys.length !== normalizedKeys.length || rawKeys.some((key, index) => key !== normalizedKeys[index])) {
          throw new TypeError(`Lark field property uses unsupported/non-canonical keys for ${table.key}.${field.fieldName}`);
        }
      }
    }
  }
  return true;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

validateReportSchemaDefinition();
