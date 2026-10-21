# HXX SmartRouter Web 原型

静态 HTML 原型，可直接用浏览器打开。使用 Tailwind CDN，无需构建。

## 目录

### 用户控制台 `user/`

| 页面 | 文件 | 说明 |
|------|------|------|
| 概览 | [index.html](user/index.html) | 余额、今日用量、快捷操作、最近请求 |
| API 密钥 | [api-keys.html](user/api-keys.html) | 创建 / 禁用 / 吊销密钥 |
| 用量与账单 | [usage.html](user/usage.html) | 消费汇总、明细表、筛选导出 |
| 可用模型 | [models.html](user/models.html) | 虚拟模型 + 可指定真实模型 |
| 接入文档 | [docs.html](user/docs.html) | 智能路由 / 指定模型 / 纯决策示例 |

### 管理后台 `admin/`

| 页面 | 文件 | 说明 |
|------|------|------|
| 运营概览 | [index.html](admin/index.html) | 请求量、成功率、任务分布、模型健康 |
| 模型目录 | [models.html](admin/models.html) | 注册与编辑模型 |
| 模型池 | [pools.html](admin/pools.html) | 池与成员 |
| 路由策略 | [policies.html](admin/policies.html) | 草稿 / 发布 / 回滚 / 测试 |
| 渠道 | [channels.html](admin/channels.html) | Direct 模式渠道与 credential_ref |
| 决策审计 | [decisions.html](admin/decisions.html) | 决策列表与 breakdown |
| 租户与配额 | [tenants.html](admin/tenants.html) | 余额、日预算、RPM |
| 系统状态 | [system.html](admin/system.html) | execution.mode 只读、就绪状态 |

## 设计要点

- **用户端**：API Key、用量、余额、可用模型与接入文档；不暴露策略与渠道配置。
- **管理端**：模型 / 池 / 策略 / 决策 / 租户；执行模式仅展示，切换走配置文件 + 重启。
- **通用网关**：不绑定 DocQA；用户侧可指定任意已授权模型。
- 视觉：用户端浅色侧栏；管理端深色侧栏，便于区分两套身份。

## 本地预览

```bash
# 例如
open user/index.html
open admin/index.html
```

或使用任意静态服务器打开 `web-prototypes` 目录。

## 多语言

- 支持：**默认**（跟随浏览器语言）、**English**、**简体中文**。
- 右上角语言选择器；偏好写入 `localStorage`（键名 `hxx_sr_lang`）。
- 实现：`assets/i18n.js` + 页面内 `data-i18n` 属性。
- 默认规则：浏览器语言以 `zh` 开头 → 简体中文，否则 → English。
- 正式产品建议改为前端框架 i18n（如 vue-i18n / react-i18next），本原型仅作交互示意。
