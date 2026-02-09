/**
 * public/js/chart.js
 *
 * 基金累计收益折线图可视化模块：基于 Chart.js 实现基金收益数据的动态图表展示
 * 依赖：
 * - Chart.js (通过 CDN 引入)
 * - snapshot.js: 提供历史快照数据获取功能
 * - fund-api.js: 提供基金实时信息获取功能
 * - fund-crud.js: 提供用户基金列表用于多基金切换
 *
 * 功能包括：
 * - 初始化和配置 Chart.js 全局样式
 * - 渲染指定基金的累计收益折线图
 * - 支持响应式设计与窗口大小自适应
 * - 多基金选择下拉菜单生成与切换
 * - 图表更新、销毁与刷新机制
 * - 完整的数据处理、格式化与错误处理逻辑
 */

// =======================
// 1. Chart.js 全局配置
// =======================

// 确保 Chart.js 已通过 CDN 加载（需在 HTML 中引入）
// 示例：<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

// 设置 Chart.js 全局默认选项
Chart.defaults.font.family = "'Microsoft YaHei', 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif";
Chart.defaults.color = '#333';
Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.1)';

// 自定义颜色方案生成函数
function generateColorScheme() {
  return {
    primary: 'rgb(54, 162, 235)',
    secondary: 'rgb(255, 99, 132)',
    positive: 'rgb(34, 139, 34)',   // 深绿色表示正收益
    negative: 'rgb(220, 20, 60)',    // 赤红色表示负收益
    grid: 'rgba(0, 0, 0, 0.05)',
    tooltipBg: 'rgba(0, 0, 0, 0.8)',
    tooltipText: '#fff'
  };
}

// =======================
// 2. 工具函数
// =======================

/**
 * 将日期字符串格式化为更友好的显示格式（MM-DD）
 * @param {string} dateString - ISO 格式的日期字符串，如 "2026-02-09"
 * @returns {string} 格式化后的日期字符串，如 "02-09"
 */
export function formatDateForDisplay(dateString) {
  try {
    if (!dateString || typeof dateString !== 'string') {
      throw new Error('无效的日期字符串');
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      throw new Error(`无法解析日期: ${dateString}`);
    }
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  } catch (error) {
    console.error('[formatDateForDisplay] 错误:', error.message);
    return dateString; // 出错时返回原始值
  }
}

/**
 * 将金额数字格式化为带千位分隔符的货币格式
 * @param {number|string} amount - 金额数值
 * @returns {string} 格式化后的金额字符串，如 "1,234.56"
 */
export function formatCurrency(amount) {
  try {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) {
      throw new Error(`无效的金额值: ${amount}`);
    }
    return num.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } catch (error) {
    console.error('[formatCurrency] 错误:', error.message);
    return String(amount);
  }
}

// =======================
// 3. 数据处理函数
// =======================

import { getSnapshotHistory } from './snapshot.js';
import { fetchFundData } from './fund-api.js';
import { getUserFunds } from './fund-crud.js';

/**
 * 获取并格式化基金历史快照数据以供 Chart.js 使用
 * @param {string} fundCode - 基金代码（6位数字）
 * @returns {Promise<Object|null>} 包含 labels 和 datasets 的图表数据对象，失败时返回 null
 */
async function formatChartData(fundCode) {
  try {
    // 参数验证
    if (!fundCode || !/^\d{6}$/.test(fundCode.trim())) {
      throw new Error(`基金代码必须是6位数字，当前值: ${fundCode}`);
    }

    // 获取历史快照数据（按时间升序排列以便绘图）
    const historyResult = await getSnapshotHistory(fundCode, { orderBy: 'asc' });
    if (!historyResult.success || !Array.isArray(historyResult.data) || historyResult.data.length === 0) {
      console.warn(`[formatChartData] 基金 ${fundCode} 暂无历史快照数据`);
      return null;
    }

    const labels = historyResult.data.map(record => formatDateForDisplay(record.snapshot_date));
    const totalProfits = historyResult.data.map(record => record.total_profit);

    return {
      labels: labels,
      datasets: [{
        label: `累计收益`,
        data: totalProfits,
        borderColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return null;
          return totalProfits[totalProfits.length - 1] >= 0 ?
            generateColorScheme().positive :
            generateColorScheme().negative;
        },
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return null;
          const gradient = ctx.createLinearGradient(0, 0, 0, chart.height);
          const colors = generateColorScheme();
          gradient.addColorStop(0, totalProfits[totalProfits.length - 1] >= 0 ?
            'rgba(34, 139, 34, 0.2)' : 'rgba(220, 20, 60, 0.2)');
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
          return gradient;
        },
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#fff',
        pointBorderColor: (value) => value.raw >= 0 ? colors.positive : colors.negative,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false
      }]
    };
  } catch (error) {
    console.error(`[formatChartData] 格式化基金 ${fundCode} 数据失败:`, error.message);
    return null;
  }
}

// =======================
// 4. 核心图表变量
// =======================

/** @type {Chart | null} 当前活动的图表实例 */
let currentChart = null;

/** @type {string | null} 当前渲染的基金代码 */
let currentFundCode = null;

/** @type {string | null} 当前基金名称 */
let currentFundName = '';

// =======================
// 5. 图表渲染与管理函数
// =======================

/**
 * 初始化图表容器，确保 canvas 存在
 * @param {string} [containerId='chart-container'] - 图表容器元素 ID
 * @returns {HTMLElement} 图表容器元素
 * @throws {Error} 当容器不存在时抛出异常
 */
export function initializeChartContainer(containerId = 'chart-container') {
  try {
    let container = document.getElementById(containerId);
    if (!container) {
      // 动态创建容器
      container = document.createElement('div');
      container.id = containerId;
      container.style.position = 'relative';
      container.style.width = '100%';
      container.style.height = '400px';
      container.style.maxWidth = '100%';
      container.style.margin = '20px auto';
      document.body.appendChild(container);
    }

    // 确保容器内有 canvas
    let canvas = container.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'fund-profit-chart';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);
    }

    return container;
  } catch (error) {
    console.error('[initializeChartContainer] 初始化失败:', error.message);
    throw error;
  }
}

/**
 * 渲染基金累计收益折线图
 * @param {string} fundCode - 基金代码（6位数字）
 * @param {string} [containerId='chart-container'] - 图表容器 ID
 * @returns {Promise<boolean>} 渲染成功返回 true，否则返回 false
 */
export async function renderFundChart(fundCode, containerId = 'chart-container') {
  try {
    // 销毁现有图表（避免内存泄漏）
    if (currentChart) {
      destroyChart();
    }

    // 验证参数
    if (!fundCode || !/^\d{6}$/.test(fundCode.trim())) {
      throw new Error(`基金代码必须是6位数字，当前值: ${fundCode}`);
    }
    const code = fundCode.trim();

    // 显示加载状态（可选）
    const container = initializeChartContainer(containerId);
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'chart-loading';
    loadingMsg.textContent = '图表加载中...';
    loadingMsg.style.textAlign = 'center';
    loadingMsg.style.padding = '20px';
    container.appendChild(loadingMsg);

    // 获取基金基本信息
    let fundName = code; // 默认名称
    try {
      const fundInfo = await fetchFundData(code);
      if (fundInfo && fundInfo.fund_name) {
        fundName = fundInfo.fund_name;
      }
    } catch (err) {
      console.warn(`[renderFundChart] 无法获取基金 ${code} 名称，使用代码代替`);
    }

    // 获取并格式化历史数据
    const chartData = await formatChartData(code);
    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
      throw new Error(`基金 ${code} 暂无可用的历史收益数据`);
    }

    // 移除加载提示
    const existingLoading = container.querySelector('#chart-loading');
    if (existingLoading) {
      container.removeChild(existingLoading);
    }

    // 创建图表实例
    const canvas = container.querySelector('canvas');
    const ctx = canvas.getContext('2d');

    const colors = generateColorScheme();

    currentChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          title: {
            display: true,
            text: `${fundName} 累计收益走势图`,
            font: {
              size: 16,
              weight: 'bold'
            },
            padding: {
              top: 10,
              bottom: 20
            }
          },
          legend: {
            display: true,
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 20,
              boxWidth: 8
            }
          },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: colors.tooltipBg,
            titleColor: colors.tooltipText,
            bodyColor: colors.tooltipText,
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderWidth: 1,
            cornerRadius: 6,
            displayColors: true,
            callbacks: {
              label: function(context) {
                return `累计收益: ${formatCurrency(context.parsed.y)} 元`;
              },
              title: function(context) {
                return `日期: ${context[0].label}`;
              }
            }
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: '交易日'
            },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 12,
              callback: function(value) {
                return this.getLabelForValue(value);
              }
            },
            grid: {
              color: colors.grid,
              drawBorder: false
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: '累计收益（元）'
            },
            ticks: {
              callback: function(value) {
                return `${formatCurrency(value)} 元`;
              },
              stepSize: Math.ceil((Math.max(...chartData.datasets[0].data) - Math.min(...chartData.datasets[0].data)) / 10)
            },
            grid: {
              color: colors.grid,
              drawBorder: false
            },
            beginAtZero: false
          }
        },
        elements: {
          line: {
            borderWidth: 2,
            borderCapStyle: 'round',
            borderJoinStyle: 'round'
          },
          point: {
            hoverBorderWidth: 3
          }
        }
      }
    });

    // 更新当前状态
    currentFundCode = code;
    currentFundName = fundName;

    console.log(`[renderFundChart] 成功渲染基金 ${code} 的累计收益图表`);
    return true;
  } catch (error) {
    // 移除加载提示
    const loadingEl = document.querySelector('#chart-loading');
    if (loadingEl) {
      loadingEl.textContent = `图表加载失败：${error.message}`;
      loadingEl.style.color = 'red';
      setTimeout(() => {
        if (loadingEl.parentNode) {
          loadingEl.parentNode.removeChild(loadingEl);
        }
      }, 3000);
    }

    console.error('[renderFundChart] 渲染失败:', error.message);
    return false;
  }
}

/**
 * 更新图表数据（不重新创建实例）
 * @param {string} fundCode - 基金代码
 * @returns {Promise<boolean>} 更新成功返回 true
 */
export async function updateChartData(fundCode) {
  try {
    if (!currentChart) {
      // 如果没有图表实例，则创建新实例
      return await renderFundChart(fundCode);
    }

    if (!fundCode || fundCode === currentFundCode) {
      // 如果未指定或与当前相同，则刷新当前数据
      fundCode = currentFundCode;
    }

    // 获取新数据
    const newData = await formatChartData(fundCode);
    if (!newData) {
      throw new Error(`无法获取基金 ${fundCode} 的新数据`);
    }

    // 更新图表数据
    currentChart.data = newData;
    currentChart.update('gentle');

    // 更新标题
    try {
      const fundInfo = await fetchFundData(fundCode);
      const newName = fundInfo?.fund_name || fundCode;
      currentChart.options.plugins.title.text = `${newName} 累计收益走势图`;
      currentChart.update('none');
    } catch (err) {
      console.warn(`[updateChartData] 无法更新基金名称显示`);
    }

    currentFundCode = fundCode;
    console.log(`[updateChartData] 成功更新基金 ${fundCode} 的图表数据`);
    return true;
  } catch (error) {
    console.error('[updateChartData] 更新失败:', error.message);
    return false;
  }
}

/**
 * 销毁当前图表实例（释放内存）
 */
export function destroyChart() {
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
    currentFundCode = null;
    currentFundName = '';
    console.log('[destroyChart] 图表实例已销毁');
  }
}

/**
 * 刷新当前图表（重新获取数据并重绘）
 * @returns {Promise<boolean>} 刷新成功返回 true
 */
export async function refreshChart() {
  if (!currentFundCode) {
    console.warn('[refreshChart] 无当前基金，无法刷新');
    return false;
  }
  return await updateChartData(currentFundCode);
}

// =======================
// 6. 响应式设计支持
// =======================

/**
 * 处理窗口大小变化，调整图表尺寸
 */
function handleResize() {
  if (currentChart) {
    currentChart.resize();
  }
}

// 监听窗口 resize 事件
window.addEventListener('resize', handleResize);

// =======================
// 7. 多基金切换功能
// =======================

/**
 * 生成基金选择下拉菜单
 * @param {string} [selectId='fund-selector'] - 下拉框元素 ID
 * @param {string} [containerId='selector-container'] - 容器元素 ID
 * @returns {Promise<boolean>} 成功生成返回 true
 */
export async function initializeFundSelector(selectId = 'fund-selector', containerId = 'selector-container') {
  try {
    // 检查是否已存在，避免重复创建
    let selectContainer = document.getElementById(containerId);
    if (!selectContainer) {
      selectContainer = document.createElement('div');
      selectContainer.id = containerId;
      selectContainer.style.margin = '20px 0';
      selectContainer.style.textAlign = 'center';
      document.body.insertBefore(selectContainer, document.body.firstChild);
    }

    let select = document.getElementById(selectId);
    if (select) {
      selectContainer.removeChild(select);
    }

    select = document.createElement('select');
    select.id = selectId;
    select.style.padding = '8px 16px';
    select.style.fontSize = '16px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #ddd';
    select.style.backgroundColor = '#fff';
    select.style.cursor = 'pointer';

    // 添加默认选项
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '请选择要查看的基金...';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    select.appendChild(defaultOption);

    // 获取用户持有的基金列表
    const fundsResult = await getUserFunds();
    if (!fundsResult.success || !Array.isArray(fundsResult.data)) {
      throw new Error(fundsResult.message || '获取基金列表失败');
    }

    if (fundsResult.data.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无持仓基金，请先添加';
      option.disabled = true;
      select.appendChild(option);
    } else {
      fundsResult.data.forEach(fund => {
        const option = document.createElement('option');
        option.value = fund.fund_code;
        option.textContent = `${fund.fund_code} - ${fund.fund_name}`;
        select.appendChild(option);
      });
    }

    selectContainer.appendChild(select);

    // 添加事件监听器
    select.addEventListener('change', async function () {
      const selectedCode = this.value;
      if (!selectedCode) return;

      // 渲染所选基金的图表
      await renderFundChart(selectedCode);
    });

    console.log('[initializeFundSelector] 基金选择器初始化完成');
    return true;
  } catch (error) {
    console.error('[initializeFundSelector] 初始化失败:', error.message);
    return false;
  }
}

// =======================
// 8. 错误处理与重试机制
// =======================

/**
 * 显示用户友好的错误提示
 * @param {string} message - 错误消息
 */
function displayErrorToUser(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'chart-error';
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #d32f2f;
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 9999;
    max-width: 300px;
    word-wrap: break-word;
  `;
  errorDiv.textContent = message;

  document.body.appendChild(errorDiv);

  // 3秒后自动消失
  setTimeout(() => {
    if (errorDiv.parentNode) {
      document.body.removeChild(errorDiv);
    }
  }, 3000);
}

/**
 * 重试函数（通用）
 * @param {Function} fn - 要重试的函数
 * @param {number} retries - 重试次数
 * @param {number} delay - 延迟毫秒数
 * @returns {Promise<any>}
 */
async function retry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1))); // 递增延迟
    }
  }
}

// =======================
// 9. 模块导出说明
// -----------------------
// 所有核心功能均已导出，可在其他模块中导入使用：
//
// import {
//   renderFundChart,
//   updateChartData,
//   destroyChart,
//   refreshChart,
//   initializeChartContainer,
//   initializeFundSelector,
//   formatDateForDisplay,
//   formatCurrency
// } from './public/js/chart.js';
// =======================
