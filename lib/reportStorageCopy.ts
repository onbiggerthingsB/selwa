import { defineText, fallback, reviewed } from '@/lib/i18n';

export const REPORT_STORAGE_COPY = {
  originalUnavailable: defineText({
    en: reviewed('The original notes are unavailable in this older record. Previously generated translations are not displayed.'),
    zh: reviewed('这份旧记录未保留原始说明。此前生成的翻译不会显示。'),
    bo: fallback('zh'),
  }),
  saveFailed: defineText({
    en: reviewed('This report could not be saved on this device. Your current report and original notes are still here. Try saving again.'),
    zh: reviewed('无法将报告保存到本机。当前报告和原始说明仍在此页面中。请重试保存。'),
    bo: fallback('zh'),
  }),
  cleanupFailed: defineText({
    en: reviewed('Your report is saved, but its temporary copy could not be cleared. Retry clearing it to finish; this will not save another copy.'),
    zh: reviewed('报告已保存，但临时副本未能清除。请重试清除以完成操作；这不会再次保存报告。'),
    bo: fallback('zh'),
  }),
  cleanupRetry: defineText({
    en: reviewed('Retry clearing and finish'),
    zh: reviewed('重试清除并完成'),
    bo: fallback('zh'),
  }),
  loadFailed: defineText({
    en: reviewed('This device could not open the stored report. Its stored data has not been changed.'),
    zh: reviewed('本设备无法打开已存储的报告。存储的数据未被修改。'),
    bo: fallback('zh'),
  }),
  someUnreadable: defineText({
    en: reviewed('Some saved reports cannot be displayed. Their stored data has not been changed.'),
    zh: reviewed('部分已保存的报告无法显示。存储的数据未被修改。'),
    bo: fallback('zh'),
  }),
  retry: defineText({
    en: reviewed('Try again'),
    zh: reviewed('重试'),
    bo: fallback('zh'),
  }),
  deleteFailed: defineText({
    en: reviewed('This report could not be deleted. Please try again.'),
    zh: reviewed('无法删除这份报告。请重试。'),
    bo: fallback('zh'),
  }),
} as const;
