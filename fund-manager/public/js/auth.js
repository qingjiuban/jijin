/**
 * public/js/auth.js
 *
 * 用户认证模块：实现基于 Supabase 的登录、登出、权限校验和本地状态管理
 * 依赖：@supabase/supabase-js (通过 CDN 引入)，需确保页面中已加载
 * 配合 config.js 使用，读取 SUPABASE_URL 和 SUPABASE_ANON_KEY 配置项
 *
 * 功能包括：
 * - Supabase 客户端初始化与配置验证
 * - 登录表单处理（含用户名格式校验）
 * - 用户凭证查询（明文密码匹配）及账户状态检查（is_active）
 * - localStorage 登录态持久化（含过期时间）
 * - 页面重定向逻辑（根据 is_admin 跳转不同页面）
 * - 完整的错误处理机制（网络异常、认证失败等）
 * - 提供辅助函数用于其他模块调用
 */

// 确保全局存在 Supabase 客户端构造函数（通过 CDN 加载）
// 示例引入方式：<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js"></script>

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// =======================
// 1. Supabase 客户端初始化
// =======================

/**
 * 初始化 Supabase 客户端实例
 * 检查配置是否完整，若未填写则提示用户并阻止后续操作
 */
let supabase = null;

try {
  // 验证必要配置是否存在且非空
  if (!SUPABASE_URL || !SUPABASE_URL.trim()) {
    throw new Error('Supabase URL 未配置，请在 config.js 中设置 SUPABASE_URL');
  }
  if (!SUPABASE_ANON_KEY || !SUPABASE_ANON_KEY.trim()) {
    throw new Error('Supabase 匿名密钥未配置，请在 config.js 中设置 SUPABASE_ANON_KEY');
  }

  // 初始化 Supabase 客户端
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (error) {
  console.error('[Supabase 初始化失败]', error.message);
  alert(`应用启动失败：${error.message}\n请检查 config.js 中的 Supabase 配置项。`);
}

// =======================
// 2. 登录表单处理逻辑
// =======================

/**
 * 处理登录表单提交事件
 * @param {Event} event - 表单提交事件对象
 * @returns {Promise<void>}
 */
export async function handleLoginFormSubmit(event) {
  try {
    // 阻止表单默认提交行为
    event.preventDefault();

    // 获取表单输入元素
    const userNameInput = document.getElementById('user_name');
    const passwordInput = document.getElementById('password');

    if (!userNameInput || !passwordInput) {
      throw new Error('登录表单缺少必要的输入字段（user_name 或 password）');
    }

    const userName = userNameInput.value.trim();
    const password = passwordInput.value;

    // 校验用户名格式：必须为8位数字
    if (!userName || !/^\d{8}$/.test(userName)) {
      throw new Error('用户名必须是8位数字');
    }

    // 校验密码是否为空
    if (!password) {
      throw new Error('请输入密码');
    }

    // 执行用户验证
    const userData = await validateUserCredentials(userName, password);

    if (!userData) {
      throw new Error('用户名或密码错误');
    }

    if (!userData.is_active) {
      throw new Error('该账户已被禁用，请联系管理员');
    }

    // 登录成功：保存用户信息至 localStorage 并跳转
    saveAuthSession(userData);
    redirectToDashboard(userData.is_admin);
  } catch (error) {
    // 统一错误处理
    const errorMsg = error instanceof Error ? error.message : String(error);
    displayErrorToUser(errorMsg);
  }
}

// =======================
// 3. Supabase 用户验证逻辑
// =======================

/**
 * 查询 users 表以验证用户凭据
 * 注意：此处使用明文密码比对，生产环境建议使用哈希存储并在应用层比对
 * @param {string} userName - 用户名（8位数字）
 * @param {string} password - 明文密码
 * @returns {Promise<Object|null>} 返回用户数据或 null（未找到/不匹配）
 */
async function validateUserCredentials(userName, password) {
  try {
    // 直接从 Supabase 查询 users 表
    const { data, error } = await supabase
      .from('users')
      .select('user_name, is_admin, is_active, created_at')
      .eq('user_name', userName)
      .eq('password', password) // 明文比对（基于当前数据库设计）
      .maybeSingle(); // 最多返回一条记录

    if (error) {
      if (error.code === 'PGRST001') {
        console.warn(`[Supabase] 用户 ${userName} 不存在`);
        return null;
      }
      throw new Error(`网络请求失败，请稍后重试（${error.message}）`);
    }

    return data || null;
  } catch (error) {
    console.error('[用户验证错误]', error);
    throw error; // 向上抛出以便统一处理
  }
}

// =======================
// 4. localStorage 登录态管理
// =======================

/**
 * 将用户登录会话信息存入 localStorage
 * 包括登录时间与7天后过期时间戳
 * @param {Object} userData - 用户数据对象（来自 Supabase 查询结果）
 */
function saveAuthSession(userData) {
  try {
    const sessionData = {
      user_name: userData.user_name,
      is_admin: Boolean(userData.is_admin),
      login_time: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7天有效期
    };

    localStorage.setItem('auth_session', JSON.stringify(sessionData));
  } catch (error) {
    console.error('[保存登录态失败]', error);
    throw new Error('无法保存登录信息，请检查浏览器隐私设置');
  }
}

/**
 * 检查当前用户的登录状态是否有效
 * @returns {Object|null} 若有效返回解析后的用户信息，否则返回 null
 */
export function checkAuthState() {
  try {
    const sessionRaw = localStorage.getItem('auth_session');
    if (!sessionRaw) return null;

    const session = JSON.parse(sessionRaw);

    // 检查是否过期
    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    if (now > expiresAt) {
      logout(); // 自动清理过期会话
      return null;
    }

    // 基本字段校验
    if (!session.user_name || typeof session.is_admin !== 'boolean') {
      logout();
      return null;
    }

    return {
      userName: session.user_name,
      isAdmin: session.is_admin,
      loginTime: session.login_time,
    };
  } catch (error) {
    console.error('[检查登录态时发生错误]', error);
    logout(); // 出错时清除异常数据
    return null;
  }
}

/**
 * 用户登出：清除 localStorage 并重定向到登录页
 */
export function logout() {
  try {
    localStorage.removeItem('auth_session');
    window.location.href = 'login.html'; // 默认跳转回登录页
  } catch (error) {
    console.error('[登出时发生错误]', error);
    // 即使清空失败也尝试跳转
    window.location.href = 'login.html';
  }
}

// =======================
// 5. 页面重定向逻辑
// =======================

/**
 * 根据用户角色进行页面重定向
 * @param {boolean} isAdmin - 是否为管理员
 */
function redirectToDashboard(isAdmin) {
  const targetPage = isAdmin ? 'admin.html' : 'home.html';
  window.location.href = targetPage;
}

// =======================
// 6. 辅助工具函数导出
// =======================

/**
 * 获取当前已登录用户的信息（同步读取 localStorage）
 * @returns {Object|null} 用户信息对象或 null（未登录）
 */
export function getCurrentUser() {
  const session = checkAuthState();
  return session ? { userName: session.userName, isAdmin: session.isAdmin } : null;
}

/**
 * 判断当前用户是否为管理员
 * @returns {boolean} 是管理员返回 true，否则 false
 */
export function isAdminUser() {
  const user = getCurrentUser();
  return user ? user.isAdmin : false;
}

// =======================
// 7. 错误处理与用户提示
// =======================

/**
 * 向用户显示友好的错误提示信息
 * 避免暴露敏感技术细节
 * @param {string} message - 错误消息
 */
function displayErrorToUser(message) {
  // 查找或创建错误提示容器
  let errorElement = document.getElementById('login-error-message');
  if (!errorElement) {
    errorElement = document.createElement('div');
    errorElement.id = 'login-error-message';
    errorElement.style.color = 'red';
    errorElement.style.margin = '10px 0';
    errorElement.style.fontSize = '14px';

    // 插入到表单之后
    const form = document.querySelector('form');
    if (form) {
      form.parentNode.insertBefore(errorElement, form.nextSibling);
    }
  }

  // 设置错误文本（仅显示通用信息，防止信息泄露）
  const publicMessage = (() => {
    if (message.includes('密码') || message.includes('凭据')) {
      return '用户名或密码错误';
    }
    if (message.includes('禁用') || message.includes('激活')) {
      return '该账户已被禁用，请联系管理员';
    }
    if (message.includes('配置') || message.includes('SUPABASE')) {
      return '系统配置异常，请联系技术人员';
    }
    if (message.includes('网络') || message.includes('请求失败')) {
      return '网络连接异常，请检查网络后重试';
    }
    return '登录失败，请稍后重试';
  })();

  errorElement.textContent = publicMessage;

  // 5秒后自动隐藏错误提示
  setTimeout(() => {
    if (errorElement && errorElement.parentNode) {
      errorElement.parentNode.removeChild(errorElement);
    }
  }, 5000);
}

// =======================
// 模块导出说明
// -----------------------
// 所有主要功能均已导出，可在其他模块中按需导入：
//
// import {
//   handleLoginFormSubmit,
//   checkAuthState,
//   logout,
//   getCurrentUser,
//   isAdminUser
// } from './public/js/auth.js';
// =======================
