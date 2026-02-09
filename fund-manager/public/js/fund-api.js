/**
 * public/js/fund-api.js
 *
 * 天天基金实时估值接口封装模块
 * 功能：通过 JSONP 请求获取基金实时估值数据，支持单个及批量基金查询
 * 依赖：config.js 中的 buildTiantianApiUrl 函数
 *
 * 使用说明：
 * - 该模块专为处理天天基金网（https://fundgz.1234567.com.cn）的 JSONP 接口设计
 * - 所有函数均以 Promise 形式返回结果，支持 async/await 语法
 * - 包含完整的错误处理、重试机制和数据标准化逻辑
 */

import { buildTiantianApiUrl } from './config.js';

// =======================
// 配置常量
// =======================

/** @type {number} 最大重试次数 */
const MAX_RETRIES = 3;

/** @type {number} 基础超时时间（毫秒） */
const TIMEOUT_MS = 10000;

/** @type {string} 动态生成的 script 标签前缀 */
const SCRIPT_PREFIX = 'tiantian-fund-jsonp-';

// =======================
// 工具函数
// =======================

/**
 * 创建带超时控制的 Promise 包装器
 * @param {Promise} promise - 要包装的 Promise
 * @param {number} ms - 超时时间（毫秒）
 * @returns {Promise} 超时控制后的 Promise
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`请求超时：${ms}ms 内未完成`));
    }, ms);

    promise
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * 验证基金代码格式是否正确
 * @param {string} fundCode - 基金代码
 * @returns {boolean} 是否为有效的6位数字基金代码
 *
 * @example
 * validateFundCode('000001'); // true
 * validateFundCode('abc');    // false
 */
export function validateFundCode(fundCode) {
  return typeof fundCode === 'string' && /^\d{6}$/.test(fundCode.trim());
}

/**
 * 解析天天基金返回的原始数据字符串
 * @param {Object} rawData - JSONP 回调中的原始数据对象
 * @returns {Object} 标准化的基金数据对象
 * @throws {Error} 当必要字段缺失或格式错误时抛出异常
 *
 * @example
 * // 输入: {"fundcode":"000001","gsz":"3.1500","gszzl":"0.86",...}
 * // 输出: { fund_code: "000001", estimated_nav: 3.15, change_rate: 0.86, ... }
 */
export function parseFundData(rawData) {
  try {
    if (!rawData || typeof rawData !== 'object') {
      throw new Error('原始数据为空或格式无效');
    }

    const requiredFields = ['fundcode', 'name', 'dwjz', 'gsz', 'gszzl', 'gztime'];
    const missingFields = requiredFields.filter(field => !(field in rawData));

    if (missingFields.length > 0) {
      throw new Error(`数据缺少必要字段: ${missingFields.join(', ')}`);
    }

    const fundCode = rawData.fundcode.trim();
    const nav = parseFloat(rawData.dwjz);
    const estimatedNav = parseFloat(rawData.gsz);
    const changeRate = parseFloat(rawData.gszzl);
    const updateTime = rawData.gztime;

    // 验证数值有效性
    if (!validateFundCode(fundCode)) {
      throw new Error(`基金代码格式无效: ${fundCode}`);
    }
    if (isNaN(nav)) {
      throw new Error(`单位净值解析失败: ${rawData.dwjz}`);
    }
    if (isNaN(estimatedNav)) {
      throw new Error(`估算净值解析失败: ${rawData.gsz}`);
    }
    if (isNaN(changeRate)) {
      throw new Error(`涨跌幅解析失败: ${rawData.gszzl}`);
    }

    const changeAmount = estimatedNav - nav;

    return {
      fund_code: fundCode,
      fund_name: rawData.name.trim(),
      nav: nav,
      estimated_nav: estimatedNav,
      change_rate: changeRate,
      change_amount: changeAmount,
      update_time: updateTime,
      is_valid: !isNaN(estimatedNav) && !isNaN(changeRate)
    };
  } catch (error) {
    console.error('[parseFundData] 数据解析失败:', error.message, rawData);
    throw error;
  }
}

// =======================
// JSONP 请求核心实现
// =======================

/**
 * 执行 JSONP 请求获取基金数据
 * @param {string} fundCode - 6位数字基金代码
 * @param {number} attempt - 当前尝试次数（用于重试机制）
 * @returns {Promise<Object>} 解析后的标准化基金数据
 * @throws {Error} 各类请求和解析错误
 */
function fetchFundDataViaJsonp(fundCode, attempt = 1) {
  return new Promise((resolve, reject) => {
    // 参数验证
    if (!validateFundCode(fundCode)) {
      return reject(new Error(`基金代码必须是6位数字，当前值: ${fundCode}`));
    }

    const url = buildTiantianApiUrl(fundCode);
    const callbackName = `${SCRIPT_PREFIX}${fundCode}_${Date.now()}`;

    // 创建 script 标签
    const script = document.createElement('script');
    script.src = `${url}?callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error(`JSONP 请求加载失败: ${url}`));
    };

    // 定义全局回调函数
    window[callbackName] = function(data) {
      try {
        // 提取实际数据对象（去除 jsonpgz 包装）
        let rawData;
        if (typeof data === 'object' && data !== null) {
          rawData = data;
        } else {
          throw new Error('接口返回数据格式异常');
        }

        // 清理环境
        cleanup();

        // 解析并返回标准化数据
        const parsedData = parseFundData(rawData);
        resolve(parsedData);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    // 清理函数：移除 script 标签和全局回调
    function cleanup() {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      delete window[callbackName];
    }

    // 添加到文档
    (document.head || document.body).appendChild(script);

    // 设置超时
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`JSONP 请求超时: ${url}`));
    }, TIMEOUT_MS);

    // 修改清理函数以清除超时
    const originalCleanup = cleanup;
    cleanup = function() {
      originalCleanup();
      clearTimeout(timeoutId);
    };
  });
}

// =======================
// 核心数据获取函数
// =======================

/**
 * 获取单只基金的实时数据（含重试机制）
 * @param {string} fundCode - 6位数字基金代码
 * @returns {Promise<Object>} 标准化的基金数据对象
 * @throws {Error} 所有请求和处理过程中的错误
 *
 * @example
 * try {
 *   const data = await fetchFundData('000001');
 *   console.log(data.estimated_nav);
 * } catch (error) {
 *   console.error('获取基金数据失败:', error.message);
 * }
 */
export async function fetchFundData(fundCode) {
  let lastError;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      const result = await withTimeout(fetchFundDataViaJsonp(fundCode, i + 1), TIMEOUT_MS);
      return result;
    } catch (error) {
      lastError = error;
      if (i >= MAX_RETRIES) break;

      // 递增重试间隔：1s, 2s, 3s
      const delay = Math.pow(2, i) * 500;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`获取基金数据失败（已重试${MAX_RETRIES}次）: ${lastError.message}`);
}

/**
 * 批量获取多只基金的实时数据
 * @param {string[]} fundCodes - 基金代码数组
 * @returns {Promise<Array>} 包含每个基金请求结果的对象数组
 * 每个结果对象包含 { success: boolean, data?: Object, error?: string }
 *
 * @example
 * const results = await fetchMultipleFundData(['000001', '123456']);
 * results.forEach(result => {
 *   if (result.success) {
 *     console.log(`${result.data.fund_code}: ${result.data.estimated_nav}`);
 *   } else {
 *     console.error(`失败: ${result.error}`);
 *   }
 * });
 */
export async function fetchMultipleFundData(fundCodes) {
  if (!Array.isArray(fundCodes)) {
    throw new Error('参数必须是基金代码数组');
  }

  // 过滤并验证有效基金代码
  const validCodes = fundCodes
    .filter(code => {
      if (!code) {
        console.warn('[fetchMultipleFundData] 忽略空的基金代码');
        return false;
      }
      if (!validateFundCode(code)) {
        console.warn(`[fetchMultipleFundData] 忽略无效基金代码: ${code}`);
        return false;
      }
      return true;
    });

  if (validCodes.length === 0) {
    throw new Error('没有有效的基金代码可供查询');
  }

  // 去重
  const uniqueCodes = [...new Set(validCodes)];

  // 并发请求所有基金数据
  return await Promise.all(
    uniqueCodes.map(async (code) => {
      try {
        const data = await fetchFundData(code);
        return { success: true, data };
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : String(error),
          fund_code: code
        };
      }
    })
  );
}

// =======================
// 默认错误处理器
// =======================

/**
 * 默认的错误处理函数
 * 可根据项目需求扩展日志上报、用户提示等功能
 * @param {Error|string} error - 错误对象或消息
 * @param {string} context - 上下文信息（如“基金数据获取失败”）
 */
export function defaultErrorHandler(error, context = '未知上下文') {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`[基金API错误] ${context}: ${errorMsg}`);

  // TODO: 可在此处集成 Sentry、监控埋点等
  // 示例：Sentry.captureException?.(error);
}

// =======================
// 模块导出说明
// -----------------------
// 本模块导出以下内容：
//
// - fetchFundData: 单只基金数据获取
// - fetchMultipleFundData: 多只基金批量获取
// - validateFundCode: 基金代码验证
// - parseFundData: 数据解析函数
// - defaultErrorHandler: 默认错误处理器
//
// 使用方式：
// import { fetchFundData, fetchMultipleFundData } from './public/js/fund-api.js';
// =======================
