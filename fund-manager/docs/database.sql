-- Supabase 数据库建表 SQL 文件
-- 生成时间: 2026-02-09
-- 描述: 定义 users、funds 和 snapshots 三张表，包含主键、外键、约束及索引

-- 启用 UUID 扩展（如需后续扩展支持）
-- 注意：本方案使用 SERIAL 主键，无需启用 uuid-ossp

-- 创建 users 表
CREATE TABLE IF NOT EXISTS users (
    user_name VARCHAR(8) PRIMARY KEY CHECK (user_name ~ '^\d{8}$'),
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 注释说明
COMMENT ON COLUMN users.user_name IS '用户账号，必须为8位数字，主键';
COMMENT ON COLUMN users.password IS '明文存储密码（建议在应用层加密）';
COMMENT ON COLUMN users.is_admin IS '是否为管理员，默认 false';
COMMENT ON COLUMN users.is_active IS '账户是否激活，默认 true';
COMMENT ON COLUMN users.created_at IS '账户创建时间，默认当前时间戳';

-- 为 users 表的 is_active 字段添加索引，便于筛选活跃用户
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- 创建 funds 表
CREATE TABLE IF NOT EXISTS funds (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(8) NOT NULL REFERENCES users(user_name) ON DELETE CASCADE,
    fund_code VARCHAR(6) NOT NULL,
    fund_name VARCHAR(100) NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- 唯一约束：同一用户不能重复添加同一基金（软删除也视为存在）
    CONSTRAINT uq_user_fund UNIQUE (user_name, fund_code)
);

-- 注释说明
COMMENT ON COLUMN funds.id IS '自增主键';
COMMENT ON COLUMN funds.user_name IS '外键，关联用户表 user_name';
COMMENT ON COLUMN funds.fund_code IS '基金代码，如 000001';
COMMENT ON COLUMN funds.fund_name IS '基金名称';
COMMENT ON COLUMN funds.is_deleted IS '逻辑删除标志，默认 false';
COMMENT ON COLUMN funds.created_at IS '记录创建时间';

-- 为 funds 表的常用查询字段添加索引
CREATE INDEX IF NOT EXISTS idx_funds_user_name ON funds(user_name);
CREATE INDEX IF NOT EXISTS idx_funds_fund_code ON funds(fund_code);
CREATE INDEX IF NOT EXISTS idx_funds_is_deleted ON funds(is_deleted);

-- 创建 snapshots 表
CREATE TABLE IF NOT EXISTS snapshots (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(8) NOT NULL REFERENCES users(user_name) ON DELETE CASCADE,
    fund_code VARCHAR(6) NOT NULL,
    snapshot_date DATE NOT NULL,
    daily_profit DECIMAL(10, 2) NOT NULL,
    total_profit DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- 外键约束：确保 fund_code 是该用户持有的基金
    CONSTRAINT fk_snapshots_fund FOREIGN KEY (user_name, fund_code) 
        REFERENCES funds(user_name, fund_code) ON DELETE CASCADE,
    -- 唯一约束：每个用户每只基金每天只能有一条快照
    CONSTRAINT uq_snapshot_daily UNIQUE (user_name, fund_code, snapshot_date)
);

-- 注释说明
COMMENT ON COLUMN snapshots.id IS '自增主键';
COMMENT ON COLUMN snapshots.user_name IS '外键，关联用户表';
COMMENT ON COLUMN snapshots.fund_code IS '基金代码，与 user_name 联合外键引用 funds';
COMMENT ON COLUMN snapshots.snapshot_date IS '交易日日期';
COMMENT ON COLUMN snapshots.daily_profit IS '当日收益，精确到小数点后两位';
COMMENT ON COLUMN snapshots.total_profit IS '累计收益，精确到小数点后两位';
COMMENT ON COLUMN snapshots.created_at IS '快照记录创建时间';

-- 为 snapshots 表添加常用查询索引
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON snapshots(user_name, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_fund_date ON snapshots(fund_code, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date);

-- 提示：建议在应用层确保密码加密处理，避免明文存储风险
-- 可考虑使用 BEFORE INSERT/UPDATE 触发器或在应用逻辑中加密
