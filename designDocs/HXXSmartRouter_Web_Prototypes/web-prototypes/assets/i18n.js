/**
 * HXX SmartRouter prototype i18n
 * Languages: default (browser), en, zh-CN
 */
(function () {
  const STORAGE_KEY = 'hxx_sr_lang';

  /** Add a language: 1) push here 2) add dict keys 3) add <option> in pages (or rebuild options in init) */
  const LANGUAGES = [
    { value: 'default', labelKey: 'lang.default' },
    { value: 'en', labelKey: 'lang.en' },
    { value: 'zh-CN', labelKey: 'lang.zh' }
  ];

  const dict = {
    // Common
    'app.name': { en: 'SmartRouter', 'zh-CN': 'SmartRouter' },
    'app.userConsole': { en: 'User Console', 'zh-CN': '用户控制台' },
    'app.adminConsole': { en: 'Admin', 'zh-CN': '管理后台' },
    'lang.label': { en: 'Language', 'zh-CN': '语言' },
    'lang.default': { en: 'Default (Browser)', 'zh-CN': '默认（跟随浏览器）' },
    'lang.en': { en: 'English', 'zh-CN': 'English' },
    'lang.zh': { en: '简体中文', 'zh-CN': '简体中文' },
    'action.logout': { en: 'Log out', 'zh-CN': '退出' },
    'action.create': { en: 'Create', 'zh-CN': '创建' },
    'action.cancel': { en: 'Cancel', 'zh-CN': '取消' },
    'action.edit': { en: 'Edit', 'zh-CN': '编辑' },
    'action.save': { en: 'Save', 'zh-CN': '保存' },
    'action.export': { en: 'Export CSV', 'zh-CN': '导出 CSV' },
    'action.viewAll': { en: 'View all', 'zh-CN': '查看全部' },
    'action.filter': { en: 'Filter', 'zh-CN': '筛选' },
    'status.ok': { en: 'Healthy', 'zh-CN': '服务正常' },
    'status.ready': { en: 'Ready', 'zh-CN': '就绪' },
    'status.enabled': { en: 'Enabled', 'zh-CN': '启用' },
    'status.disabled': { en: 'Disabled', 'zh-CN': '已禁用' },

    // User nav
    'user.nav.overview': { en: 'Overview', 'zh-CN': '概览' },
    'user.nav.keys': { en: 'API Keys', 'zh-CN': 'API 密钥' },
    'user.nav.usage': { en: 'Usage & Billing', 'zh-CN': '用量与账单' },
    'user.nav.models': { en: 'Models', 'zh-CN': '可用模型' },
    'user.nav.docs': { en: 'Docs', 'zh-CN': '接入文档' },

    // User overview
    'user.overview.title': { en: 'Overview', 'zh-CN': '概览' },
    'user.overview.balance': { en: 'Balance', 'zh-CN': '账户余额' },
    'user.overview.todayCalls': { en: 'Requests today', 'zh-CN': '今日调用' },
    'user.overview.todaySpend': { en: 'Spend today', 'zh-CN': '今日消费' },
    'user.overview.activeKeys': { en: 'Active API keys', 'zh-CN': '活跃 API Key' },
    'user.overview.chart': { en: 'Usage (7 days)', 'zh-CN': '近 7 日用量' },
    'user.overview.quick': { en: 'Quick actions', 'zh-CN': '快捷操作' },
    'user.overview.createKey': { en: 'Create API Key', 'zh-CN': '创建 API Key' },
    'user.overview.viewUsage': { en: 'View usage details', 'zh-CN': '查看用量明细' },
    'user.overview.viewDocs': { en: 'View integration guide', 'zh-CN': '查看接入示例' },
    'user.overview.tip': {
      en: 'Prefer virtual model hxx/auto for policy-based routing. You may also specify an authorized real model alias.',
      'zh-CN': '推荐使用虚拟模型 hxx/auto 由策略自动选模；也可直接指定已授权的真实模型别名。'
    },
    'user.overview.recent': { en: 'Recent requests', 'zh-CN': '最近请求' },
    'user.overview.col.time': { en: 'Time', 'zh-CN': '时间' },
    'user.overview.col.model': { en: 'Virtual / specified', 'zh-CN': '虚拟/指定模型' },
    'user.overview.col.actual': { en: 'Actual model', 'zh-CN': '实际模型' },
    'user.overview.col.task': { en: 'Task', 'zh-CN': '任务' },
    'user.overview.col.tokens': { en: 'Tokens', 'zh-CN': 'Tokens' },
    'user.overview.col.cost': { en: 'Cost', 'zh-CN': '费用' },
    'user.overview.forced': { en: 'Forced', 'zh-CN': '指定' },

    // User API keys
    'user.keys.title': { en: 'API Keys', 'zh-CN': 'API 密钥' },
    'user.keys.create': { en: '+ Create key', 'zh-CN': '+ 创建密钥' },
    'user.keys.desc': {
      en: 'Keys authenticate SmartRouter API calls. Store them securely; the full key is shown only once.',
      'zh-CN': '密钥用于调用 SmartRouter API。请妥善保管，创建后仅展示一次完整 Key。'
    },
    'user.keys.col.name': { en: 'Name', 'zh-CN': '名称' },
    'user.keys.col.preview': { en: 'Key preview', 'zh-CN': '密钥预览' },
    'user.keys.col.scope': { en: 'Scope', 'zh-CN': '权限范围' },
    'user.keys.col.status': { en: 'Status', 'zh-CN': '状态' },
    'user.keys.col.last': { en: 'Last used', 'zh-CN': '最近使用' },
    'user.keys.col.created': { en: 'Created', 'zh-CN': '创建时间' },
    'user.keys.col.actions': { en: 'Actions', 'zh-CN': '操作' },
    'user.keys.scope.full': { en: 'Full routing', 'zh-CN': '全量路由' },
    'user.keys.scope.virtual': { en: 'Virtual models only', 'zh-CN': '仅虚拟模型' },
    'user.keys.disable': { en: 'Disable', 'zh-CN': '禁用' },
    'user.keys.enable': { en: 'Enable', 'zh-CN': '启用' },
    'user.keys.revoke': { en: 'Revoke', 'zh-CN': '吊销' },
    'user.keys.security': {
      en: 'Security: never expose API keys in frontend code or public repos. Revoke immediately if leaked.',
      'zh-CN': '安全提示：不要在前端或公开仓库中暴露 API Key。泄露后请立即吊销并重新创建。'
    },
    'user.keys.modal.title': { en: 'Create API Key', 'zh-CN': '创建 API Key' },
    'user.keys.modal.name': { en: 'Name', 'zh-CN': '名称' },
    'user.keys.modal.scope': { en: 'Scope', 'zh-CN': '权限范围' },
    'user.keys.modal.expiry': { en: 'Expiry (optional)', 'zh-CN': '过期时间（可选）' },

    // User usage
    'user.usage.title': { en: 'Usage & Billing', 'zh-CN': '用量与账单' },
    'user.usage.period': { en: 'Period spend', 'zh-CN': '本期消费' },
    'user.usage.tokens': { en: 'Total tokens', 'zh-CN': '总 Token' },
    'user.usage.balance': { en: 'Balance', 'zh-CN': '账户余额' },
    'user.usage.topup': { en: 'Request top-up / contact admin', 'zh-CN': '申请充值 / 联系管理员' },

    // User models
    'user.models.title': { en: 'Available models', 'zh-CN': '可用模型' },
    'user.models.desc': {
      en: 'Prefer virtual models for automatic routing. You may also specify an authorized real model (all execution modes).',
      'zh-CN': '推荐使用虚拟模型由策略自动选模。也可直接指定下方已授权的真实模型（所有执行模式下均支持）。'
    },
    'user.models.virtual': { en: 'Virtual models (recommended)', 'zh-CN': '虚拟模型（推荐）' },
    'user.models.real': { en: 'Directly selectable models', 'zh-CN': '可直接指定的真实模型' },
    'user.models.autoRoute': { en: 'Smart routing', 'zh-CN': '智能路由' },
    'user.models.available': { en: 'Available', 'zh-CN': '可用' },

    // User docs
    'user.docs.title': { en: 'Integration', 'zh-CN': '接入文档' },
    'user.docs.s1': { en: '1. Smart routing (recommended)', 'zh-CN': '1. 智能路由（推荐）' },
    'user.docs.s1d': {
      en: 'Use a virtual model; policy selects the physical model by task.',
      'zh-CN': '使用虚拟模型，由策略按任务自动选择真实模型。'
    },
    'user.docs.s2': { en: '2. Specify a model', 'zh-CN': '2. 直接指定模型' },
    'user.docs.s2d': {
      en: 'Allowed in all execution modes for authorized models; still subject to permission and budget checks.',
      'zh-CN': '所有执行模式下均可指定已授权模型；仍受权限与预算约束。'
    },
    'user.docs.s3': { en: '3. Route-only API', 'zh-CN': '3. 纯决策接口' },
    'user.docs.s3d': {
      en: 'Get routing decision only; call upstream yourself (multi-stage pipelines).',
      'zh-CN': '只获取路由结果，由业务侧自行调用上游（适合多阶段流水线）。'
    },

    // Admin nav
    'admin.nav.overview': { en: 'Overview', 'zh-CN': '概览' },
    'admin.nav.models': { en: 'Models', 'zh-CN': '模型目录' },
    'admin.nav.pools': { en: 'Pools', 'zh-CN': '模型池' },
    'admin.nav.policies': { en: 'Policies', 'zh-CN': '路由策略' },
    'admin.nav.channels': { en: 'Channels (Direct)', 'zh-CN': '渠道 (Direct)' },
    'admin.nav.decisions': { en: 'Decisions', 'zh-CN': '决策审计' },
    'admin.nav.tenants': { en: 'Tenants & Quotas', 'zh-CN': '租户与配额' },
    'admin.nav.system': { en: 'System', 'zh-CN': '系统状态' },

    // Admin overview
    'admin.overview.title': { en: 'Operations', 'zh-CN': '运营概览' },
    'admin.overview.todayReq': { en: 'Requests today', 'zh-CN': '今日请求' },
    'admin.overview.success': { en: 'Route success rate', 'zh-CN': '路由成功率' },
    'admin.overview.modelsPools': { en: 'Models / pools', 'zh-CN': '启用模型 / 池' },
    'admin.overview.failover': { en: 'Failovers', 'zh-CN': 'Failover 次数' },
    'admin.overview.taskDist': { en: 'Task mix (today)', 'zh-CN': '任务类型分布（今日）' },
    'admin.overview.health': { en: 'Model health', 'zh-CN': '模型健康' },
    'admin.overview.recent': { en: 'Recent decisions', 'zh-CN': '最近决策' },
    'admin.overview.col.decision': { en: 'Decision ID', 'zh-CN': 'Decision ID' },
    'admin.overview.col.mode': { en: 'Mode', 'zh-CN': '模式' },
    'admin.overview.col.task': { en: 'Task', 'zh-CN': '任务' },
    'admin.overview.col.selected': { en: 'Selected', 'zh-CN': '选中模型' },
    'admin.overview.col.reason': { en: 'Reason', 'zh-CN': '原因码' },
    'admin.overview.col.latency': { en: 'Latency', 'zh-CN': '耗时' },

    'admin.role.super': { en: 'Super admin', 'zh-CN': '超级管理员' },
    'admin.models.title': { en: 'Model catalog', 'zh-CN': '模型目录' },
    'admin.models.add': { en: '+ Register model', 'zh-CN': '+ 注册模型' },
    'admin.pools.title': { en: 'Model pools', 'zh-CN': '模型池' },
    'admin.pools.add': { en: '+ New pool', 'zh-CN': '+ 新建池' },
    'admin.policies.title': { en: 'Routing policies', 'zh-CN': '路由策略' },
    'admin.policies.add': { en: '+ New draft', 'zh-CN': '+ 新建策略草稿' },
    'admin.channels.title': { en: 'Channels', 'zh-CN': '渠道管理' },
    'admin.channels.add': { en: '+ Add channel', 'zh-CN': '+ 添加渠道' },
    'admin.channels.hint': {
      en: 'Active only when execution.mode = direct. Keys are injected via env; configure credential_ref only.',
      'zh-CN': '仅当 execution.mode = direct 时生效。Key 通过环境变量注入，此处只配置 credential_ref。'
    },
    'admin.decisions.title': { en: 'Decision audit', 'zh-CN': '决策审计' },
    'admin.tenants.title': { en: 'Tenants & quotas', 'zh-CN': '租户与配额' },
    'admin.tenants.add': { en: '+ Tenant', 'zh-CN': '+ 租户' },
    'admin.system.title': { en: 'System status', 'zh-CN': '系统状态' },
    'admin.system.mode': { en: 'Execution mode (read-only)', 'zh-CN': '执行模式（只读）' },
    'admin.system.modeHint': {
      en: 'Set by config execution.mode; restart required after change. No hot-switch in admin UI.',
      'zh-CN': '由配置文件 execution.mode 决定，修改后须重启进程。管理后台不提供热切换。'
    }
  };

  function resolveLang(pref) {
    if (!pref || pref === 'default') {
      const nav = (navigator.language || 'en').toLowerCase();
      if (nav.startsWith('zh')) return 'zh-CN';
      return 'en';
    }
    if (pref === 'zh-CN' || pref === 'zh') return 'zh-CN';
    return 'en';
  }

  function getPref() {
    return localStorage.getItem(STORAGE_KEY) || 'default';
  }

  function setPref(pref) {
    localStorage.setItem(STORAGE_KEY, pref);
  }

  function t(key, lang) {
    const row = dict[key];
    if (!row) return null;
    return row[lang] || row.en || key;
  }

  function apply(lang) {
    document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key, lang);
      if (val == null) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.hasAttribute('data-i18n-placeholder')) el.placeholder = val;
        else el.value = val;
      } else {
        el.textContent = val;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key, lang);
      if (val != null) el.placeholder = val;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      const val = t(key, lang);
      if (val != null) el.setAttribute('title', val);
    });
    // Sync select
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = getPref();
  }

  function buildSelect(sel, currentLang) {
    if (!sel) return;
    const pref = getPref();
    sel.innerHTML = '';
    LANGUAGES.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.value;
      opt.textContent = t(item.labelKey, currentLang) || item.value;
      sel.appendChild(opt);
    });
    sel.value = pref;
  }

  function init() {
    const pref = getPref();
    const lang = resolveLang(pref);

    const sel = document.getElementById('lang-select');
    buildSelect(sel, lang);
    apply(lang);
    // refresh option labels after apply
    buildSelect(sel, lang);

    if (sel && !sel._hxxBound) {
      sel._hxxBound = true;
      sel.addEventListener('change', () => {
        setPref(sel.value);
        const next = resolveLang(sel.value);
        buildSelect(sel, next);
        apply(next);
      });
    }
  }

  window.HXXI18n = { t, apply, getPref, setPref, resolveLang, init, dict, LANGUAGES };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
