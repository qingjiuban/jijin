/**
 * public/js/fund-crud.js
 *
 * 基金持仓管理模块：实现基金的增删查改（CRUD）操作
 * 依赖：
 * - auth.js: 提供 Supabase 客户端实例和当前用户信息
 * - fund-api.js: 提供基金实时估值数据获取功能
 * - config.js: 提供辅助函数和配置项
 *
 * 功能包括：
 * - 添加基金（addFund）
 * - 查询用户持仓列表（getUserFunds）
 * - 删除基金（支持保留/清空历史收益的高级删除）
 * - 更新基金信息（updateFund）
 * - 辅助功能和完整错误处理
 */

import { supabase } from './auth.js';
import { fetchFundData, fetchMultipleFundData } from './fund-api.js';
import { defaultErrorHandler } from './config.js';

// =======================
// 模块级变量
// =======================

/** @type {string|null} 当前登录用户的用户名 */
let currentUser = null;

// 初始化时获取当前用户
try {
  const session = checkAuthState?.();
  if (session) {
    currentUser = session.userName;
  }
} catch (error) {
  defaultErrorHandler(error, '初始化获取用户信息');
}

// 如果 checkAuthState 来自 auth.js，需要显式导入
// 注意：根据实际导出情况调整
if (typeof checkAuthState === 'undefined') {
  console.warn('[警告] checkAuthState 未找到，将尝试从全局作用域获取用户信息');
}

// =======================
// 1. 添加基金功能 (addFund)
// =======================

/**
 * 添加基金到用户持仓
 * @param {string} fundCode - 基金代码（6位数字）
 * @param {string} fundName - 基金名称
 * @returns {Promise<{success: boolean, message: string, data?: object}>}
 */
export async function addFund(fundCode, fundName) {
  try {
    // 参数验证
    if (!fundCode || !/^\\d{6}$/.test(fundCode.trim())) {
      return { success: false, message: '基金代码必须是6位数字' };
    }
    if (!fundName || fundName.trim().length === 0) {
      return { success: false, message: '基金名称不能为空' };
    }
    if (fundName.trim().length > 100) {
      return { success: false, message: '基金名称长度不能超过100个字符' };
    }

    const code = fundCode.trim();
    const name = fundName.trim();

    // 检查是否已登录
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    // 检查是否已持有该基金（防止重复添加）
    const hasFund = await checkIfUserHasFund(code);
    if (hasFund) {
      return { success: false, message: `您已持有基金 ${code}，无法重复添加` };
    }

    // 插入新基金记录
    const { error } = await supabase
      .from('funds')
      .insert({
        user_name: currentUser,
        fund_code: code,
        fund_name: name,
        is_deleted: false
      });

    if (error) {
      if (error.code === '23505') { // 唯一约束冲突
        return { success: false, message: '该基金已存在（数据库层面）' };
      }
      throw error;
    }

    return {
      success: true,
      message: `成功添加基金：${code} - ${name}`,
      data: { fund_code: code, fund_name: name }
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, `添加基金失败: ${fundCode}`);
    return { success: false, message: `添加基金失败：${errorMsg}` };
  }
}

// =======================
// 2. 查询持仓列表功能 (getUserFunds)
// =======================

/**
 * 获取当前用户持有的所有有效基金及其实时估值
 * @returns {Promise<{success: boolean, message: string, data?: Array}>}
 */
export async function getUserFunds() {
  try {
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    // 查询 funds 表中未删除的基金
    const { data: fundRecords, error } = await supabase
      .from('funds')
      .select('fund_code, fund_name')
      .eq('user_name', currentUser)
      .eq('is_deleted', false);

    if (error) {
      throw error;
    }

    if (!fundRecords || fundRecords.length === 0) {
      return { success: true, message: '暂无持仓基金', data: [] };
    }

    // 批量获取实时估值数据（并发优化）
    const fundCodes = fundRecords.map(f => f.fund_code);
    const marketDataResults = await fetchMultipleFundData(fundCodes);

    // 合并本地持仓与市场数据
    const formattedData = fundRecords.map(record => {
      const marketData = marketDataResults.find(m => m.fund_code === record.fund_code);
      
      return {
        fund_code: record.fund_code,
        fund_name: record.fund_name,
        nav: marketData ? marketData.nav : null,
        estimated_nav: marketData ? marketData.estimated_nav : null,
        change_rate: marketData ? marketData.change_rate : null,
        change_amount: marketData ? marketData.change_amount : null,
        update_time: marketData ? marketData.update_time : null,
        is_valid: marketData ? marketData.is_valid : false
      };
    });

    return {
      success: true,
      message: `成功获取 ${formattedData.length} 只基金持仓`,
      data: formattedData
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, '获取用户基金列表失败');
    return { success: false, message: `获取基金列表失败：${errorMsg}` };
  }
}

// =======================
// 3. 高级删除基金功能 (deleteFund)
// =======================

/**
 * 显示删除确认弹窗并执行删除操作
 * @param {string} fundCode - 要删除的基金代码
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function deleteFund(fundCode) {
  return new Promise((resolve) => {
    // 创建确认对话框
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '1000';

    const dialog = document.createElement('div');
    dialog.style.backgroundColor = 'white';
    dialog.style.padding = '20px';
    dialog.style.borderRadius = '8px';
    dialog.style.textAlign = 'center';
    dialog.style.minWidth = '300px';

    dialog.innerHTML = `
      <h3 style="margin-top:0;">确认删除基金 ${fundCode}？</h3>
      <p>请选择删除方式：</p>
      <div style="margin:15px 0;">
        <button id="btn-keep" style="padding:10px;margin:5px;min-width:120px;">保留历史收益</button>
        <button id="btn-clear" style="padding:10px;margin:5px;min-width:120px;color:red;">清空历史收益</button>
      </div>
      <button id="btn-cancel" style="padding:8px;margin:5px;">取消</button>
    `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    const cleanup = () => {
      if (modal.parentNode) {
        document.body.removeChild(modal);
      }
    };

    const btnKeep = dialog.querySelector('#btn-keep');
    const btnClear = dialog.querySelector('#btn-clear');
    const btnCancel = dialog.querySelector('#btn-cancel');

    const handleKeep = async () => {
      cleanup();
      const result = await executeDeleteKeepHistory(fundCode);
      resolve(result);
    };

    const handleClear = async () => {
      cleanup();
      const result = await executeDeleteClearHistory(fundCode);
      resolve(result);
    };

    btnKeep.addEventListener('click', handleKeep);
    btnClear.addEventListener('click', handleClear);
    btnCancel.addEventListener('click', () => {
      cleanup();
      resolve({ success: false, message: '用户取消删除操作' });
    });

    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cleanup();
        resolve({ success: false, message: '用户取消删除操作' });
      }
    });
  });
}

// =======================
// 4. 删除基金执行逻辑
// =======================

/**
 * 执行“保留历史收益”的删除操作（逻辑删除）
 * @param {string} fundCode - 基金代码
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function executeDeleteKeepHistory(fundCode) {
  try {
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    const { error } = await supabase
      .from('funds')
      .update({ is_deleted: true })
      .eq('user_name', currentUser)
      .eq('fund_code', fundCode);

    if (error) {
      throw error;
    }

    return { success: true, message: `已将基金 ${fundCode} 标记为已删除（保留历史收益）` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, `保留删除基金失败: ${fundCode}`);
    return { success: false, message: `删除操作失败：${errorMsg}` };
  }
}

/**
 * 执行“清空历史收益”的删除操作（物理删除 + 关联快照删除）
 * @param {string} fundCode - 基金代码
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function executeDeleteClearHistory(fundCode) {
  try {
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    // 使用 Supabase 的事务机制（通过函数或批量请求模拟原子性）
    // 先删除 snapshots 表中的相关记录
    const { error: snapshotError } = await supabase
      .from('snapshots')
      .delete()
      .eq('user_name', currentUser)
      .eq('fund_code', fundCode);

    if (snapshotError) {
      throw new Error(`删除收益快照失败：${snapshotError.message}`);
    }

    // 再删除 funds 表中的记录
    const { error: fundError } = await supabase
      .from('funds')
      .delete()
      .eq('user_name', currentUser)
      .eq('fund_code', fundCode);

    if (fundError) {
      // 尝试回滚 snapshots 删除（尽力而为）
      try {
        await supabase.from('snapshots').insert({
          user_name: currentUser,
          fund_code: fundCode,
          snapshot_date: new Date().toISOString().split('T')[0],
          daily_profit: 0,
          total_profit: 0
        });
      } catch (rollbackError) {
        console.warn('回滚快照删除失败:', rollbackError);
      }
      throw new Error(`删除基金记录失败：${fundError.message}`);
    }

    return { success: true, message: `已彻底删除基金 ${fundCode} 及其全部历史收益` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, `清空删除基金失败: ${fundCode}`);
    return { success: false, message: `删除操作失败：${errorMsg}` };
  }
}

// =======================
// 5. 更新基金信息功能 (updateFund)
// =======================

/**
 * 更新基金名称
 * @param {string} fundCode - 基金代码
 * @param {string} newFundName - 新的基金名称
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function updateFund(fundCode, newFundName) {
  try {
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    // 参数验证
    if (!fundCode || !/^\\d{6}$/.test(fundCode.trim())) {
      return { success: false, message: '基金代码必须是6位数字' };
    }
    if (!newFundName || newFundName.trim().length === 0) {
      return { success: false, message: '基金名称不能为空' };
    }
    if (newFundName.trim().length > 100) {
      return { success: false, message: '基金名称长度不能超过100个字符' };
    }

    const name = newFundName.trim();

    // 检查基金是否存在且属于当前用户
    const hasFund = await checkIfUserHasFund(fundCode);
    if (!hasFund) {
      return { success: false, message: `基金 ${fundCode} 不存在或不属于当前用户` };
    }

    // 执行更新
    const { error } = await supabase
      .from('funds')
      .update({ fund_name: name })
      .eq('user_name', currentUser)
      .eq('fund_code', fundCode);

    if (error) {
      throw error;
    }

    return { success: true, message: `基金名称已更新为：${name}` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, `更新基金信息失败: ${fundCode}`);
    return { success: false, message: `更新失败：${errorMsg}` };
  }
}

// =======================
// 6. 辅助功能
// =======================

/**
 * 判断当前用户是否持有某只基金
 * @param {string} fundCode - 基金代码
 * @returns {Promise<boolean>}
 */
export async function checkIfUserHasFund(fundCode) {
  try {
    if (!currentUser || !validateFundCode(fundCode)) {
      return false;
    }

    const { data, error } = await supabase
      .from('funds')
      .select('id')
      .eq('user_name', currentUser)
      .eq('fund_code', fundCode)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) {
      console.warn(`检查基金持有状态时出错: ${error.message}`);
      return false;
    }

    return !!data;
  } catch (error) {
    defaultErrorHandler(error, `检查基金持有状态失败: ${fundCode}`);
    return false;
  }
}

/**
 * 获取单只基金的详细信息（包含实时估值）
 * @param {string} fundCode - 基金代码
 * @returns {Promise<{success: boolean, message: string, data?: object}>}
 */
export async function getFundDetails(fundCode) {
  try {
    if (!validateFundCode(fundCode)) {
      return { success: false, message: '基金代码格式无效' };
    }

    // 获取基金基本信息
    const { data: fundInfo, error } = await supabase
      .from('funds')
      .select('fund_name')
      .eq('user_name', currentUser)
      .eq('fund_code', fundCode)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!fundInfo) {
      return { success: false, message: '基金不存在或已删除' };
    }

    // 获取实时估值
    const marketResult = await fetchFundData(fundCode);
    if (!marketResult.success) {
      return { success: false, message: marketResult.message };
    }

    return {
      success: true,
      message: '获取基金详情成功',
      data: {
        ...marketResult.data,
        fund_name: fundInfo.fund_name
      }
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, `获取基金详情失败: ${fundCode}`);
    return { success: false, message: `获取详情失败：${errorMsg}` };
  }
}

/**
 * 批量删除多只基金（仅支持“保留历史收益”模式）
 * @param {string[]} fundCodes - 基金代码数组
 * @returns {Promise<{success: boolean, message: string, results?: Array}>}
 */
export async function deleteMultipleFunds(fundCodes) {
  try {
    if (!Array.isArray(fundCodes) || fundCodes.length === 0) {
      return { success: false, message: '请提供要删除的基金代码列表' };
    }

    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    const results = [];

    for (const code of fundCodes) {
      if (!validateFundCode(code)) {
        results.push({ fund_code: code, success: false, message: '基金代码格式无效' });
        continue;
      }

      const result = await executeDeleteKeepHistory(code);
      results.push({ fund_code: code, ...result });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    return {
      success: true,
      message: `批量删除完成：成功 ${successCount} 只，失败 ${failCount} 只`,
      results
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    defaultErrorHandler(error, '批量删除基金失败');
    return { success: false, message: `批量删除过程中发生错误：${errorMsg}` };
  }
}

// =======================
// 模块导出说明
// -----------------------
// 导出所有核心和辅助函数，供其他模块使用
//
// import {
//   addFund,
//   getUserFunds,
//   deleteFund,
//   updateFund,
//   checkIfUserHasFund,
//   getFundDetails,
//   deleteMultipleFunds
// } from './public/js/fund-crud.js';
// =======================
