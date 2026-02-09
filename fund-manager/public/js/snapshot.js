/**
 * public/js/snapshot.js
 *
 * 收益快照核心模块：实现基金收益的每日快照记录、计算与查询功能
 * 依赖：
 * - auth.js: 提供 Supabase 客户端实例和当前用户信息
 * - fund-api.js: 提供基金实时估值数据获取功能
 * - config.js: 提供交易日判断和日期格式化工具函数
 *
 * 功能包括：
 * - 交易日检查与当日收益/累计收益计算
 * - 快照防重复提交机制
 * - 单只及批量基金快照创建
 * - 历史快照查询与展示
 * - 完整的错误处理与日志记录
 */

import { supabase } from './auth.js';
import { fetchFundData } from './fund-api.js';
import { isTradingDay, getTodayFormatted } from './config.js';

// =======================
// 模块级变量
// =======================

/** @type {string|null} 当前登录用户的用户名 */
let currentUser = null;

// 初始化时获取当前用户信息
try {
  const session = window.checkAuthState?.();
  if (session) {
    currentUser = session.userName;
  }
} catch (error) {
  console.warn('[snapshot.js] 获取当前用户失败:', error.message);
}

// 如果未从全局获取到 checkAuthState，尝试动态导入（可选增强）
if (!currentUser) {
  console.warn('[snapshot.js] 未检测到登录态，部分功能将受限');
}

// =======================
// 1. 交易日检查逻辑
// =======================

/**
 * 检查当前是否为交易日
 * @returns {Object} 包含是否为交易日和当前日期的信息
 * @property {boolean} isTradingDay - 是否为交易日
 * @property {string|null} date - 格式化的当前日期（YYYY-MM-DD），非交易日返回 null
 */
export function checkTradingDay() {
  try {
    const todayIsTradingDay = isTradingDay();
    if (!todayIsTradingDay) {
      return {
        isTradingDay: false,
        date: null
      };
    }

    const formattedDate = getTodayFormatted();
    return {
      isTradingDay: true,
      date: formattedDate
    };
  } catch (error) {
    console.error('[checkTradingDay] 错误:', error.message);
    return {
      isTradingDay: false,
      date: null
    };
  }
}

// =======================
// 2. 当日收益计算功能
// =======================

/**
 * 计算指定基金的当日收益
 * @param {string} fundCode - 基金代码（6位数字）
 * @param {string} userName - 用户名（8位数字）
 * @returns {Promise<number>} 当日收益金额（精确到小数点后两位）
 * @throws {Error} 当参数无效、网络请求失败或数据异常时抛出
 */
export async function calculateDailyProfit(fundCode, userName) {
  try {
    // 参数验证
    if (!fundCode || !/^\d{6}$/.test(fundCode.trim())) {
      throw new Error(`基金代码格式无效: ${fundCode}`);
    }
    if (!userName || !/^\d{8}$/.test(userName)) {
      throw new Error(`用户名格式无效: ${userName}`);
    }

    // 获取实时估值数据
    const marketData = await fetchFundData(fundCode);

    if (!marketData.is_valid) {
      throw new Error(`基金 ${fundCode} 的实时数据无效`);
    }

    // 基于估算净值与单位净值的差额计算当日收益（以1元本金为例）
    // 实际应用中可根据持仓成本调整算法
    const changeAmountPerUnit = marketData.change_amount; // 每单位涨跌金额
    const dailyProfit = Number((changeAmountPerUnit).toFixed(2)); // 简化模型：假设持有1份

    return dailyProfit;
  } catch (error) {
    console.error(`[calculateDailyProfit] 计算基金 ${fundCode} 当日收益失败:`, error.message);
    throw error;
  }
}

// =======================
// 3. 累计收益计算功能
// =======================

/**
 * 计算指定基金的累计收益
 * @param {string} fundCode - 基金代码
 * @param {string} userName - 用户名
 * @param {number} dailyProfit - 当日收益
 * @param {string} snapshotDate - 快照日期（YYYY-MM-DD）
 * @returns {Promise<number>} 累计收益值（精确到小数点后两位）
 * @throws {Error} 当数据库查询失败或计算异常时抛出
 */
export async function calculateTotalProfit(fundCode, userName, dailyProfit, snapshotDate) {
  try {
    // 参数验证
    if (!fundCode || !/^\d{6}$/.test(fundCode)) {
      throw new Error(`基金代码格式无效: ${fundCode}`);
    }
    if (!userName || !/^\d{8}$/.test(userName)) {
      throw new Error(`用户名格式无效: ${userName}`);
    }
    if (typeof dailyProfit !== 'number' || isNaN(dailyProfit)) {
      throw new Error(`当日收益必须是有效数字: ${dailyProfit}`);
    }
    if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      throw new Error(`快照日期格式无效: ${snapshotDate}`);
    }

    // 解析当前日期，获取上一交易日
    const currentDate = new Date(snapshotDate);
    let previousDate = new Date(currentDate);
    previousDate.setDate(previousDate.getDate() - 1);

    // 向前查找最近的交易日作为上一交易日
    let attempts = 0;
    let lastTotalProfit = null;

    while (attempts < 7 && lastTotalProfit === null) { // 最多回溯7天
      const prevDateString = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;

      if (isTradingDay(previousDate)) {
        // 查询 snapshots 表获取上一交易日的累计收益
        const { data, error } = await supabase
          .from('snapshots')
          .select('total_profit')
          .eq('user_name', userName)
          .eq('fund_code', fundCode)
          .eq('snapshot_date', prevDateString)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data && typeof data.total_profit === 'number') {
          lastTotalProfit = data.total_profit;
        }
      }

      previousDate.setDate(previousDate.getDate() - 1);
      attempts++;
    }

    // 计算累计收益
    let totalProfit;
    if (lastTotalProfit !== null) {
      totalProfit = Number((lastTotalProfit + dailyProfit).toFixed(2));
    } else {
      // 无历史记录，当日收益即为初始累计收益
      totalProfit = Number(dailyProfit.toFixed(2));
    }

    return totalProfit;
  } catch (error) {
    console.error(`[calculateTotalProfit] 计算基金 ${fundCode} 累计收益失败:`, error.message);
    throw error;
  }
}

// =======================
// 4. 快照防重复检查
// =======================

/**
 * 检查指定基金在指定日期是否已存在快照记录
 * @param {string} fundCode - 基金代码
 * @param {string} userName - 用户名
 * @param {string} snapshotDate - 快照日期（YYYY-MM-DD）
 * @returns {Promise<boolean>} 是否已存在
 * @throws {Error} 当数据库查询失败时抛出
 */
export async function checkSnapshotExists(fundCode, userName, snapshotDate) {
  try {
    // 参数验证
    if (!fundCode || !/^\d{6}$/.test(fundCode)) {
      throw new Error(`基金代码格式无效: ${fundCode}`);
    }
    if (!userName || !/^\d{8}$/.test(userName)) {
      throw new Error(`用户名格式无效: ${userName}`);
    }
    if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      throw new Error(`快照日期格式无效: ${snapshotDate}`);
    }

    const { data, error } = await supabase
      .from('snapshots')
      .select('id')
      .eq('user_name', userName)
      .eq('fund_code', fundCode)
      .eq('snapshot_date', snapshotDate)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return !!data;
  } catch (error) {
    console.error(`[checkSnapshotExists] 检查快照是否存在失败:`, error.message);
    throw error;
  }
}

// =======================
// 5. 核心快照创建函数
// =======================

/**
 * 为指定基金创建当日收益快照
 * @param {string} fundCode - 基金代码
 * @returns {Promise<{success: boolean, message: string, data?: object}>} 操作结果
 */
export async function createDailySnapshot(fundCode) {
  try {
    // 1. 检查是否为交易日
    const tradingDayInfo = checkTradingDay();
    if (!tradingDayInfo.isTradingDay) {
      return {
        success: false,
        message: '今日不是交易日，无法创建快照'
      };
    }

    const snapshotDate = tradingDayInfo.date;

    // 2. 验证参数
    if (!fundCode || !/^\d{6}$/.test(fundCode.trim())) {
      return {
        success: false,
        message: `基金代码格式无效: ${fundCode}`
      };
    }
    if (!currentUser) {
      return {
        success: false,
        message: '用户未登录，无法创建快照'
      };
    }

    const code = fundCode.trim();

    // 3. 检查是否已存在当日快照（防止重复提交）
    const exists = await checkSnapshotExists(code, currentUser, snapshotDate);
    if (exists) {
      return {
        success: false,
        message: `基金 ${code} 在 ${snapshotDate} 已存在快照记录`
      };
    }

    // 4. 计算当日收益
    let dailyProfit;
    try {
      dailyProfit = await calculateDailyProfit(code, currentUser);
    } catch (calcError) {
      return {
        success: false,
        message: `计算基金 ${code} 当日收益失败: ${calcError.message}`
      };
    }

    // 5. 计算累计收益
    let totalProfit;
    try {
      totalProfit = await calculateTotalProfit(code, currentUser, dailyProfit, snapshotDate);
    } catch (calcError) {
      return {
        success: false,
        message: `计算基金 ${code} 累计收益失败: ${calcError.message}`
      };
    }

    // 6. 写入 snapshots 表
    const { error } = await supabase
      .from('snapshots')
      .insert({
        user_name: currentUser,
        fund_code: code,
        snapshot_date: snapshotDate,
        daily_profit: dailyProfit,
        total_profit: totalProfit
      });

    if (error) {
      if (error.code === '23505') { // 唯一约束冲突
        return {
          success: false,
          message: `操作冲突：基金 ${code} 在 ${snapshotDate} 的快照记录已存在`
        };
      }
      throw error;
    }

    return {
      success: true,
      message: `成功创建基金 ${code} 的收益快照`,
      data: {
        fund_code: code,
        snapshot_date: snapshotDate,
        daily_profit: dailyProfit,
        total_profit: totalProfit
      }
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[createDailySnapshot] 创建快照失败:`, errorMsg);
    return {
      success: false,
      message: `创建快照失败：${errorMsg}`
    };
  }
}

// =======================
// 6. 批量快照功能
// =======================

/**
 * 为当前用户持有的所有基金创建当日快照
 * @returns {Promise<{success: boolean, message: string, results: Array}>} 批量操作结果汇总
 */
export async function createSnapshotsForAllFunds() {
  try {
    if (!currentUser) {
      return {
        success: false,
        message: '用户未登录，无法创建快照',
        results: []
      };
    }

    // 先检查是否为交易日
    const tradingDayInfo = checkTradingDay();
    if (!tradingDayInfo.isTradingDay) {
      return {
        success: false,
        message: '今日不是交易日，无法创建快照',
        results: []
      };
    }

    // 查询用户持有的所有有效基金
    const { data: fundRecords, error: queryError } = await supabase
      .from('funds')
      .select('fund_code')
      .eq('user_name', currentUser)
      .eq('is_deleted', false);

    if (queryError) {
      throw queryError;
    }

    if (!fundRecords || fundRecords.length === 0) {
      return {
        success: true,
        message: '暂无持仓基金，无需创建快照',
        results: []
      };
    }

    // 并发执行所有基金的快照创建（注意：生产环境可考虑限流）
    const fundCodes = fundRecords.map(f => f.fund_code);
    const results = await Promise.all(
      fundCodes.map(async (code) => {
        try {
          const result = await createDailySnapshot(code);
          return {
            fund_code: code,
            ...result
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return {
            fund_code: code,
            success: false,
            message: `创建快照时发生未知错误: ${errorMsg}`
          };
        }
      })
    );

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    let finalMessage;
    if (successCount === 0) {
      finalMessage = '所有基金快照创建均失败';
    } else if (successCount === totalCount) {
      finalMessage = `成功为 ${successCount} 只基金创建了当日快照`;
    } else {
      finalMessage = `部分成功：${successCount}/${totalCount} 只基金快照创建成功`;
    }

    return {
      success: successCount > 0,
      message: finalMessage,
      results
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[createSnapshotsForAllFunds] 批量创建快照失败:', errorMsg);
    return {
      success: false,
      message: `批量创建快照失败：${errorMsg}`,
      results: []
    };
  }
}

// =======================
// 7. 历史快照查询功能
// =======================

/**
 * 获取指定基金的历史快照记录
 * @param {string} fundCode - 基金代码
 * @param {'30d'|'90d'|'all'|Object} [timeRange='all'] - 时间范围筛选条件
 *                                    '30d': 最近30天，'90d': 最近90天，'all': 所有记录
 *                                    或传入 { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } 自定义范围
 * @returns {Promise<{success: boolean, message: string, data?: Array}>} 查询结果
 */
export async function getSnapshotHistory(fundCode, timeRange = 'all') {
  try {
    // 参数验证
    if (!fundCode || !/^\d{6}$/.test(fundCode.trim())) {
      return {
        success: false,
        message: `基金代码格式无效: ${fundCode}`
      };
    }
    if (!currentUser) {
      return {
        success: false,
        message: '用户未登录，无法查询历史快照'
      };
    }

    const code = fundCode.trim();

    // 构建查询条件
    let startDate = null;
    let endDate = null;

    if (timeRange === '30d') {
      const now = new Date();
      const pastDate = new Date(now);
      pastDate.setDate(now.getDate() - 30);
      startDate = pastDate.toISOString().split('T')[0];
      endDate = now.toISOString().split('T')[0];
    } else if (timeRange === '90d') {
      const now = new Date();
      const pastDate = new Date(now);
      pastDate.setDate(now.getDate() - 90);
      startDate = pastDate.toISOString().split('T')[0];
      endDate = now.toISOString().split('T')[0];
    } else if (timeRange === 'all') {
      // 不设时间限制
    } else if (typeof timeRange === 'object' && timeRange.start && timeRange.end) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(timeRange.start) || !/^\d{4}-\d{2}-\d{2}$/.test(timeRange.end)) {
        return {
          success: false,
          message: '自定义时间范围格式无效，应为 YYYY-MM-DD'
        };
      }
      startDate = timeRange.start;
      endDate = timeRange.end;
    } else {
      return {
        success: false,
        message: '无效的时间范围参数'
      };
    }

    // 构建 Supabase 查询
    let query = supabase
      .from('snapshots')
      .select('*')
      .eq('user_name', currentUser)
      .eq('fund_code', code)
      .order('snapshot_date', { ascending: false }); // 按日期倒序排列

    if (startDate) {
      query = query.gte('snapshot_date', startDate);
    }
    if (endDate) {
      query = query.lte('snapshot_date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        message: `基金 ${code} 在指定范围内无历史快照记录`,
        data: []
      };
    }

    // 格式化数据以支持图表显示
    const formattedData = data.map(record => ({
      id: record.id,
      fund_code: record.fund_code,
      snapshot_date: record.snapshot_date,
      daily_profit: record.daily_profit,
      total_profit: record.total_profit,
      created_at: record.created_at,
      // 添加用于图表的标准化字段
      date: record.snapshot_date,
      value: record.total_profit,
      change: record.daily_profit
    }));

    return {
      success: true,
      message: `成功获取基金 ${code} 的 ${formattedData.length} 条历史快照`,
      data: formattedData
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[getSnapshotHistory] 查询基金 ${fundCode} 历史快照失败:`, errorMsg);
    return {
      success: false,
      message: `查询历史快照失败：${errorMsg}`
    };
  }
}

// =======================
// 模块导出说明
// -----------------------
// 导出所有核心功能函数，供其他模块调用：
//
// import {
//   createDailySnapshot,
//   createSnapshotsForAllFunds,
//   getSnapshotHistory,
//   calculateDailyProfit,
//   calculateTotalProfit,
//   checkSnapshotExists
// } from './public/js/snapshot.js';
//
// 或整体导入：
// import * as snapshot from './public/js/snapshot.js';
// =======================
