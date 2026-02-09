/**
 * public/js/config.js
 * 
 * 项目配置文件：包含 Supabase 配置、天天基金 API 接口设置、交易日判断逻辑等
 * 
 * 使用说明：
 * 1. 将此文件保存为 public/js/config.js
 * 2. 在 HTML 中通过 <script type="module"> 引入，或在其他 JS 模块中 import 导入
 * 3. 所有配置项均通过 ES6 export 导出，支持按需导入
 */

// =======================
// 1. Supabase 配置
// =======================

/**
 * Supabase 项目 URL
 * 获取方式：登录 Supabase 控制台 → 项目设置 → API → URL
 * 示例格式：https://<project-ref>.supabase.co
 * 用户需自行替换为实际的项目 URL
 * 
 * @type {string}
 */
export let SUPABASE_URL = 'https://mhhsxspmyaxiyjtvakql.supabase.co'; // 用户填写自己的 Supabase URL

/**
 * Supabase 匿名密钥（anon key）
 * 获取方式：登录 Supabase 控制台 → 项目设置 → API → anon 公开密钥
 * 示例格式：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxxx
 * 用户需自行替换为实际的 anon key
 * 
 * ⚠️ 安全提示：该密钥用于前端匿名访问，请勿泄露给不可信方
 * 
 * @type {string}
 */
export let SUPABASE_ANON_KEY = 'sb_publishable_tUugMVRiZOttSL1-9ocHZQ_1rduLEsz'; // 用户填写自己的 anon key

// =======================
// 2. 天天基金 API 配置
// =======================

/**
 * 天天基金实时估值接口基础 URL
 * 接口文档参考：https://fundgz.1234567.com.cn/
 * 
 * @type {string}
 */
export const TIANTIAN_API_BASE_URL = 'https://fundgz.1234567.com.cn/js/';

/**
 * 接口返回文件后缀
 * 实际请求时会拼接 fund code 和此 suffix 构成完整 URL
 * 
 * @type {string}
 */
export const TIANTIAN_API_SUFFIX = '.js';

/**
 * 构建完整的天天基金实时估值接口地址
 * 
 * @param {string} fundCode - 基金代码（6位数字字符串）
 * @returns {string} 完整的接口 URL
 * @throws {Error} 当 fundCode 格式无效时抛出错误
 * 
 * @example
 * const url = buildTiantianApiUrl('000001');
 * // 返回: "https://fundgz.1234567.com.cn/js/000001.js"
 */
export function buildTiantianApiUrl(fundCode) {
  if (!fundCode || !/^\d{6}$/.test(fundCode.trim())) {
    throw new Error('基金代码必须是6位数字');
  }
  return `${TIANTIAN_API_BASE_URL}${fundCode.trim()}${TIANTIAN_API_SUFFIX}`;
}

// =======================
// 3. 交易日判定逻辑
// =======================

/**
 * 默认节假日列表（示例数据，用户可根据实际情况更新）
 * 格式：'YYYY-MM-DD' 字符串数组
 * 注意：此处仅作示例，真实场景应结合官方发布的年度休市安排动态维护
 * 
 * @type {string[]}
 */
export let HOLIDAYS = [
  '2026-01-01', // 元旦
  '2026-02-17', // 春节假期示例
  '2026-02-18',
  '2026-04-04', // 清明节
  '2026-05-01', // 劳动节
  '2026-06-08', // 端午节
  '2026-09-19', // 中秋节
  '2026-10-01', // 国庆节
  '2026-10-02'
];

/**
 * 判断指定日期是否为中国股市交易日
 * 规则：
 * - 排除周六、周日
 * - 排除法定节假日（由 HOLIDAYS 数组定义）
 * - 节假日列表可由用户动态更新
 * 
 * @param {Date|string} [date] - 要判断的日期，默认为当前日期
 * @returns {boolean} 是否为交易日
 * @throws {Error} 当传入日期格式无效时抛出错误
 * 
 * @example
 * isTradingDay(); // 判断今天是否为交易日
 * isTradingDay('2026-02-14'); // 判断特定日期
 */
export function isTradingDay(date = new Date()) {
  try {
    // 如果传入的是字符串，尝试解析为日期
    if (typeof date === 'string') {
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        throw new Error(`无效的日期格式: ${date}`);
      }
      date = parsedDate;
    }

    // 确保是有效的 Date 对象
    if (!(date instanceof Date)) {
      throw new Error(`参数必须是 Date 对象或可解析的日期字符串`);
    }

    // 获取年月日部分用于比较（避免时间影响）
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    // 检查是否为周末（0=周日，6=周六）
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // 检查是否在节假日列表中
    if (HOLIDAYS.includes(dateString)) {
      return false;
    }

    // 符合条件则为交易日
    return true;

  } catch (error) {
    console.error('[isTradingDay] 错误:', error.message);
    // 出错时保守返回 false，防止非交易日误操作
    return false;
  }
}

// =======================
// 4. 工具函数与默认配置
// =======================

/**
 * 获取当前日期的格式化字符串（YYYY-MM-DD）
 * 
 * @returns {string} 格式化的日期字符串
 * 
 * @example
 * const today = getTodayFormatted(); // 如 "2026-02-09"
 */
export function getTodayFormatted() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 默认错误处理机制
 * 可根据项目需求扩展日志上报、用户提示等功能
 * 
 * @param {Error|string} error - 错误对象或消息
 * @param {string} context - 上下文信息（如“Supabase连接失败”）
 */
export function defaultErrorHandler(error, context = '未知上下文') {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`[错误处理] ${context}: ${errorMsg}`);

  // TODO: 可在此处集成 Sentry、监控埋点等
  // 示例：Sentry.captureException?.(error);
}

// =======================
// 模块导出说明
// -----------------------
// 所有变量和函数均已使用 export 导出，可在其他模块中按需导入：
//
// import { SUPABASE_URL, isTradingDay, buildTiantianApiUrl } from './public/js/config.js';
//
// 或整体导入：
// import * as config from './public/js/config.js';
// =======================
</file_content>
