# HXXSmartRouter 详细技术设计

- 版本：V1.0
- 日期：2026-10-21
- 状态：MVP 实施基线
- 首个场景：HXXDocQA Kit（复杂文档解析、OCR、RAG、问答）
- 技术路线：Go + MySQL + NewAPI；规则筛选 + 评分排序 + 必要时轻量分类

## 1. 产品定位

HXXSmartRouter 是 HXX 生态的独立模型决策服务，负责判断“当前任务应该使用哪个模型”，不负责替代 NewAPI 进行模型渠道管理、上游凭证管理、请求转发和计费。

### 1.1 目标

1. 管理模型元数据、模型池、虚拟模型入口和版本化路由策略。
2. 根据任务类型、输入模态、上下文要求、预算、质量要求和健康状态筛选候选模型。
3. 使用可解释评分选择模型。
4. 规则无法可靠识别任务时，按需调用轻量分类模型。
5. 记录路由决策、实际模型、延迟、错误和成本估算，支持回放、灰度和回滚。
6. 为 HXXDocQA Kit 的 OCR 后处理、文档结构化、Embedding、Rerank、RAG 问答等不同任务提供路由。

### 1.2 非目标

- 不实现 OCR、PDF 解析、切片、向量数据库或 RAG 本身。
- 不管理供应商 API Key；凭证保留在 NewAPI。
- 不在首期训练自己的分类器或学习型路由器。
- 不实现通用工作流/Agent 编排。
- 不默认存储原始文档、完整提示词和模型输出。
- 不复制 NewAPI 已具备的计费、渠道重试和用户额度功能。

## 2. 关键设计决策

| 决策 | 方案 |
|---|---|
| 主语言 | Go |
| HTTP | `net/http` + `chi`（也可统一使用团队现有轻量框架） |
| 数据库 | 优先 MySQL 8；若新项目统一 PostgreSQL，也可替换 |
| ORM | `sqlc` 或手写 `database/sql`；避免核心查询被复杂 ORM 隐藏 |
| 配置热更新 | DB 发布版本 + 进程内不可变快照 |
| 缓存 | 首期内存缓存；多副本时可选 Redis |
| 上游调用 | NewAPI OpenAI 兼容端点 |
| 认证 | 服务间 Bearer Token；管理 API 独立权限 |
| 观测 | 结构化 JSON 日志、Prometheus 指标、request_id |
| 部署 | 单个 Go 二进制 + MySQL + 现有 NewAPI |
| 分类器 | 规则优先；低置信度时调用指定的小模型；超时则回退规则 |

## 3. 组件与请求生命周期

```text
HXXDocQA Kit
    |
    | POST /v1/chat/completions (model=hxx/docqa-auto)
    v
HXXSmartRouter
    1. Auth / Tenant / Quota Guard
    2. Normalize Request
    3. Resolve Virtual Model
    4. Extract Features (task, modality, token estimate, document hints)
    5. Rule Classification
    6. Optional Lightweight Classifier
    7. Candidate Hard Filters
    8. Candidate Scoring
    9. Persist Decision (metadata only)
   10. Forward to NewAPI using selected physical model alias
    |
    v
NewAPI
    |
    v
Provider model
```

注意：路由器首期可同时提供 `/v1/chat/completions` 代理入口和 `/v1/route` 纯决策 API。纯决策 API 适合 HXXDocQA Kit 在 OCR、Embedding、Rerank 等不同执行器中按任务选择模型；代理入口适合标准聊天请求。

## 4. HXXDocQA Kit 的任务分类体系

不要把所有文档任务统称为 `document`。建议使用稳定的枚举：

| task_type | 说明 | 常见能力要求 |
|---|---|---|
| `document_classification` | 判断文件类型/主题 | 短文本、低延迟 |
| `document_extraction` | 抽取字段、表格、实体 | 结构化输出、指令遵循 |
| `document_ocr_postprocess` | OCR 文本纠错、版面恢复 | 长文本、结构保留 |
| `document_summarization` | 文档摘要 | 长上下文、摘要质量 |
| `document_reasoning` | 合同风险、跨段落推理 | 高质量、长上下文 |
| `rag_query_rewrite` | 查询改写/扩展 | 低延迟、低成本 |
| `rag_answer` | 基于检索上下文回答 | 引用遵循、长上下文 |
| `embedding` | 文本向量化 | Embedding 模型 |
| `reranking` | 对检索结果重排 | Reranker 模型 |
| `vision_document_understanding` | 直接理解页面图片 | 视觉输入 |
| `general_chat` | 通用对话 | 通用文本能力 |
| `code_generation` | 代码生成/分析 | 代码能力 |

OCR 引擎本身通常是独立的 OCR 服务/工具，不应假设聊天模型可以代替 OCR。SmartRouter 只负责对确实需要模型推理的 OCR 后处理、版面理解或视觉理解任务选型。

## 5. Go 项目目录

```text
hxx-smart-router/
├── cmd/
│   └── hxx-smart-router/
│       └── main.go
├── internal/
│   ├── app/
│   │   ├── app.go
│   │   └── lifecycle.go
│   ├── config/
│   │   ├── config.go
│   │   └── validate.go
│   ├── transport/
│   │   ├── httpserver.go
│   │   ├── middleware/
│   │   │   ├── auth.go
│   │   │   ├── requestid.go
│   │   │   ├── recover.go
│   │   │   └── ratelimit.go
│   │   ├── handlers/
│   │   │   ├── chat_completions.go
│   │   │   ├── route.go
│   │   │   ├── health.go
│   │   │   └── admin.go
│   │   └── dto/
│   ├── domain/
│   │   ├── model.go
│   │   ├── pool.go
│   │   ├── policy.go
│   │   ├── request.go
│   │   ├── decision.go
│   │   └── errors.go
│   ├── routing/
│   │   ├── engine.go
│   │   ├── normalize.go
│   │   ├── features.go
│   │   ├── classifier.go
│   │   ├── rule_classifier.go
│   │   ├── llm_classifier.go
│   │   ├── candidate_filter.go
│   │   ├── scorer.go
│   │   ├── strategy.go
│   │   ├── fallback.go
│   │   └── explain.go
│   ├── catalog/
│   │   ├── repository.go
│   │   └── service.go
│   ├── policy/
│   │   ├── repository.go
│   │   ├── compiler.go
│   │   ├── publisher.go
│   │   └── snapshot.go
│   ├── executor/
│   │   ├── newapi_client.go
│   │   ├── chat_proxy.go
│   │   ├── sse.go
│   │   └── retry.go
│   ├── persistence/
│   │   ├── mysql.go
│   │   ├── model_repo.go
│   │   ├── policy_repo.go
│   │   └── decision_repo.go
│   ├── telemetry/
│   │   ├── logger.go
│   │   ├── metrics.go
│   │   └── tracing.go
│   └── security/
│       ├── secrets.go
│       └── redaction.go
├── migrations/
│   ├── 001_init.sql
│   └── 002_seed_docqa.sql
├── configs/
│   ├── config.example.yaml
│   └── policies.example.yaml
├── deployments/
│   ├── Dockerfile
│   ├── docker-compose.example.yml
│   └── systemd/
├── scripts/
│   ├── migrate.sh
│   └── smoke-test.sh
├── docs/
│   ├── architecture.md
│   ├── api.md
│   └── operations.md
├── Makefile
├── go.mod
└── README.md
```

### 5.1 依赖方向

- `domain` 不依赖数据库、HTTP 框架或 NewAPI。
- `routing` 依赖领域接口，不直接操作 SQL。
- `persistence` 实现仓储接口。
- `executor` 负责向 NewAPI 发请求，不负责决定路由策略。
- `transport` 只做 DTO 校验、认证和调用应用服务。
- `policy/compiler.go` 在发布时把策略编译成运行时快照，热路径不查数据库。

## 6. 数据库 DDL（MySQL 8）

以下是 MVP 起始 DDL。生产迁移应通过版本化 migration 执行；价格用 `DECIMAL`，时间统一 UTC，配置 JSON 需要应用层做严格 schema 校验。

```sql
CREATE TABLE sr_providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  gateway_type VARCHAR(32) NOT NULL DEFAULT 'newapi',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  description VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_providers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_models (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(96) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  upstream_model VARCHAR(192) NOT NULL COMMENT 'NewAPI 中可调用的模型别名',
  capabilities JSON NOT NULL,
  context_window INT UNSIGNED NULL,
  max_output_tokens INT UNSIGNED NULL,
  input_price_per_million DECIMAL(18,8) NULL,
  output_price_per_million DECIMAL(18,8) NULL,
  supports_stream TINYINT(1) NOT NULL DEFAULT 1,
  supports_vision TINYINT(1) NOT NULL DEFAULT 0,
  supports_json_mode TINYINT(1) NOT NULL DEFAULT 0,
  quality_score DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
  reliability_score DECIMAL(5,4) NOT NULL DEFAULT 0.9500,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_models_code (code),
  KEY idx_sr_models_provider (provider_id, enabled),
  CONSTRAINT fk_sr_models_provider FOREIGN KEY (provider_id) REFERENCES sr_providers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_model_pools (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(96) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  pool_type VARCHAR(32) NOT NULL DEFAULT 'chat',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_model_pools_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_pool_members (
  pool_id BIGINT UNSIGNED NOT NULL,
  model_id BIGINT UNSIGNED NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  weight DECIMAL(8,4) NOT NULL DEFAULT 1.0000,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  constraints_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (pool_id, model_id),
  KEY idx_sr_pool_members_order (pool_id, enabled, priority),
  CONSTRAINT fk_sr_pool_members_pool FOREIGN KEY (pool_id) REFERENCES sr_model_pools(id),
  CONSTRAINT fk_sr_pool_members_model FOREIGN KEY (model_id) REFERENCES sr_models(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_routing_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(96) NOT NULL,
  name VARCHAR(128) NOT NULL,
  strategy_type VARCHAR(32) NOT NULL DEFAULT 'weighted_score',
  config_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_policy_code_version (code, version),
  KEY idx_sr_policy_status (status, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_virtual_models (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(96) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  default_policy_code VARCHAR(96) NOT NULL,
  default_task_type VARCHAR(64) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  allowed_capabilities JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_virtual_models_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_route_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  policy_code VARCHAR(96) NOT NULL,
  rule_code VARCHAR(96) NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  conditions_json JSON NOT NULL,
  target_pool_code VARCHAR(96) NOT NULL,
  overrides_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_route_rule (policy_code, rule_code),
  KEY idx_sr_route_rules_order (policy_code, enabled, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_route_decisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(96) NULL,
  app_id VARCHAR(96) NULL,
  virtual_model VARCHAR(96) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  difficulty VARCHAR(16) NULL,
  policy_code VARCHAR(96) NOT NULL,
  policy_version INT UNSIGNED NOT NULL,
  selected_model_id BIGINT UNSIGNED NULL,
  selected_model_code VARCHAR(96) NULL,
  candidate_summary JSON NULL COMMENT '只保存候选评分和淘汰原因，不保存完整提示词',
  reason_code VARCHAR(64) NOT NULL,
  estimated_input_tokens INT UNSIGNED NULL,
  estimated_cost DECIMAL(18,8) NULL,
  actual_cost DECIMAL(18,8) NULL,
  latency_ms INT UNSIGNED NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'decided',
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_route_decisions_request (request_id),
  KEY idx_sr_decisions_tenant_time (tenant_id, created_at),
  KEY idx_sr_decisions_model_time (selected_model_code, created_at),
  KEY idx_sr_decisions_task_time (task_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sr_model_health (
  model_id BIGINT UNSIGNED NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'unknown',
  consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
  success_rate DECIMAL(5,4) NULL,
  latency_p50_ms INT UNSIGNED NULL,
  latency_p95_ms INT UNSIGNED NULL,
  last_error_code VARCHAR(64) NULL,
  last_checked_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (model_id),
  CONSTRAINT fk_sr_model_health_model FOREIGN KEY (model_id) REFERENCES sr_models(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 6.1 DDL 实施注意事项

1. `upstream_model` 存的是 NewAPI 暴露的模型名称，不存上游供应商密钥。
2. `capabilities` 建议使用稳定 JSON schema，例如 `["chat","long_context","json"]`；不要在代码中依赖任意自由文本。
3. `quality_score` 是人工基准分或离线评测分，不是对所有任务通用的客观质量真值。后续可按任务类型单独保存评测分。
4. `candidate_summary` 仅记录模型 ID、分数、过滤原因和简短特征，不保存用户全文。
5. `sr_route_decisions` 的 `request_id` 应由服务端生成并贯穿日志；如果未来需要同一业务请求内多次路由，应改为 `decision_id` 主键并把 `request_id` 改成非唯一索引。
6. `sr_model_health` 是运行时观测，不应在每个请求中同步写入。可用后台定时任务更新，或先只使用进程内滑动窗口。
7. 生产中应增加数据库迁移版本表、软删除策略及审计日志表；删除模型前检查是否被已发布策略引用。

## 7. 配置结构

### 7.1 服务配置 `config.yaml`

```yaml
server:
  listen: "127.0.0.1:8090"
  read_timeout: 10s
  write_timeout: 0s        # SSE 代理不要设置过短的整体写超时
  idle_timeout: 90s
  max_body_bytes: 20971520 # 20 MiB，按业务需要调整

database:
  driver: mysql
  dsn: "${HXX_SR_DB_DSN}"
  max_open_conns: 20
  max_idle_conns: 5
  conn_max_lifetime: 30m

newapi:
  base_url: "http://newapi:3000"
  api_key_env: "HXX_SR_NEWAPI_KEY"
  timeout: 90s
  connect_timeout: 3s
  max_retries_before_stream: 1

security:
  service_tokens_env: "HXX_SR_SERVICE_TOKENS"
  admin_tokens_env: "HXX_SR_ADMIN_TOKENS"
  trust_forwarded_headers: false
  log_prompt_content: false

routing:
  default_virtual_model: "hxx/auto"
  classification_timeout: 1500ms
  max_classification_calls: 1
  max_candidates: 8
  default_strategy: "balanced"
  decision_timeout: 2s
  fail_open_to_default_model: false
  health_failure_threshold: 3
  health_cooldown: 30s
  max_estimated_cost_usd: 0.10
  config_poll_interval: 10s

telemetry:
  metrics_enabled: true
  metrics_path: "/metrics"
  log_level: "info"
  log_format: "json"
```

生产环境不要把密钥写入 YAML 或提交到 Git。`fail_open_to_default_model` 默认 false，防止路由异常时静默绕过预算或能力限制。只有在定义了明确、合规的安全兜底模型后，才考虑开启。

### 7.2 路由策略配置示例

策略 JSON 存入 `sr_routing_policies.config_json`，下例用于说明字段含义：

```json
{
  "version": 1,
  "strategy": "weighted_score",
  "weights": {
    "quality": 0.45,
    "cost": 0.25,
    "latency": 0.15,
    "reliability": 0.15
  },
  "constraints": {
    "max_estimated_cost_usd": 0.05,
    "require_enabled": true,
    "require_healthy": true
  },
  "classification": {
    "enabled": true,
    "mode": "fallback",
    "min_confidence": 0.72,
    "model_pool": "router_classifier"
  },
  "escalation": {
    "enabled": true,
    "max_attempts": 2,
    "on_invalid_json": true,
    "on_context_overflow": true
  }
}
```

建议把不同任务类型的权重配置在策略中，不要硬编码在 Go 代码里。配置发布时必须进行 schema 校验、引用完整性检查、权重归一化检查和候选池可用性检查。

## 8. 路由算法

### 8.1 标准流程

1. 校验认证、租户、调用权限、请求大小和预算上限。
2. 解析虚拟模型，例如 `hxx/docqa-auto`。
3. 规范化请求并抽取特征：显式任务标签、消息长度、模态、文档类型、输出格式、上下文需求。
4. 先执行规则分类。
5. 规则分类置信度低于阈值时，才调用轻量分类模型；分类调用必须有超时、预算和单次调用限制。
6. 根据任务类型匹配路由规则，得到目标模型池。
7. 对模型池成员进行硬条件过滤。
8. 对剩余候选计算评分并排序。
9. 记录决策元数据和策略版本。
10. 将真实模型别名交给 NewAPI 执行。
11. 记录执行结果、用量和延迟；如果失败，按错误类型决定是否在首个 token 发出前切换备用模型。

### 8.2 特征抽取

建议首期只抽取低成本、可解释的特征：

```go
type RequestFeatures struct {
    VirtualModel      string
    TaskType          string
    Difficulty        string // low, medium, high, unknown
    InputModality     []string
    EstimatedTokens   int
    RequiresVision    bool
    RequiresJSON      bool
    RequiresLongCtx   bool
    QualityPreference string // economy, balanced, quality
    BudgetUSD         float64
    TenantID          string
    AppID             string
}
```

不要仅依靠字符数推断精确 token 数。首期可用保守估算；对超长输入要考虑消息模板、系统提示和检索上下文的额外开销。最终调用仍需由上游模型的实际上下文限制兜底。

### 8.3 规则分类优先级

建议按以下优先级匹配：

1. 经认证且授权的调用方显式任务标签。
2. 虚拟模型入口的默认任务类型。
3. 文件处理阶段传入的任务类型（如 `embedding`、`reranking`）。
4. 可解释规则：是否含图片、JSON 输出要求、输入长度、OCR 后处理标记等。
5. 轻量分类模型。
6. 分类超时或失败时使用安全默认规则；若没有合适默认模型，则返回明确错误。

调用方传入的任务标签只能影响路由意图，不能覆盖租户权限、成本上限或能力限制。

### 8.4 硬条件过滤

候选模型必须满足所有硬条件：

- 模型、供应商和池成员均启用。
- 具备当前任务所需能力，例如 vision、JSON mode、embedding 或 reranking。
- 上下文窗口大于估算输入 token + 预留输出 token。
- 预计成本不超过请求、租户和全局预算中的最小值。
- 健康状态不处于明确的 open/cooldown 状态。
- 符合租户、数据区域、隐私级别和允许供应商约束。
- 符合本次任务的模型类型要求；Embedding/Reranker 不得误路由到普通聊天模型。

如果候选全部被过滤，不能偷偷选一个不符合硬约束的模型。应返回 `NO_ELIGIBLE_MODEL`，并给出可审计的原因码。

### 8.5 评分公式

将每项归一化到 0–1：

```text
score =
    w_quality     * quality_score
  + w_cost        * cost_score
  + w_latency     * latency_score
  + w_reliability * reliability_score
  + w_affinity    * task_affinity_score
```

其中：

- `quality_score`：对应任务类型的离线评测分或人工初始分。
- `cost_score`：在可比较候选中，预计成本越低分数越高。
- `latency_score`：根据近期 p50/p95 延迟映射到 0–1。
- `reliability_score`：根据滑动窗口成功率和错误率计算。
- `task_affinity_score`：模型在当前任务类别上的适配度。

先做硬约束，再做评分。权重必须非负且总和为 1。没有可靠数据的指标应采用中性默认值并标注数据不足，不能假装有精确测量。

### 8.6 评分伪代码

```go
func (e *Engine) Route(ctx context.Context, req RouteRequest) (Decision, error) {
    features, err := e.extractFeatures(ctx, req)
    if err != nil {
        return Decision{}, err
    }

    task := e.ruleClassifier.Classify(features)
    if task.Confidence < e.policy.MinRuleConfidence &&
       e.policy.ClassificationEnabled {
        classified, classifyErr := e.llmClassifier.Classify(ctx, features, req)
        if classifyErr == nil && classified.Confidence >= e.policy.MinConfidence {
            task = classified
        }
        // 分类服务失败：保留规则结果，不无限重试。
    }

    pool, policy, err := e.resolvePool(task, req)
    if err != nil {
        return Decision{}, err
    }

    candidates := e.filterEligible(pool, features, req)
    if len(candidates) == 0 {
        return Decision{}, ErrNoEligibleModel
    }

    for i := range candidates {
        candidates[i].Score = e.score(candidates[i], features, policy)
    }
    sort.SliceStable(candidates, func(i, j int) bool {
        if candidates[i].Score == candidates[j].Score {
            return candidates[i].Priority < candidates[j].Priority
        }
        return candidates[i].Score > candidates[j].Score
    })

    return e.makeDecision(req, features, task, policy, candidates), nil
}
```

这是算法骨架，不是可直接编译的完整实现。正式实现需要补充取消传播、并发安全、审计写入失败策略、价格缺失处理及可观测性。

### 8.7 成本估算

```text
estimated_cost =
  estimated_input_tokens  / 1_000_000 * input_price_per_million
+ reserved_output_tokens  / 1_000_000 * output_price_per_million
```

如果价格未知，应标记为 `unknown`，不能把未知成本当成零成本。对预算严格的请求，未知价格模型应被排除，除非策略显式允许。

最终实际成本以 NewAPI 的用量与计费数据为准。流式请求可能在连接中断时拿不到最终 usage，因此不能把缺少 usage 当作零费用。

### 8.8 轻量分类器协议

分类器只返回受限 JSON，不返回任意模型名：

```json
{
  "task_type": "document_reasoning",
  "difficulty": "high",
  "requires_vision": false,
  "requires_long_context": true,
  "confidence": 0.84
}
```

校验枚举、数值范围和响应大小。分类器不得直接指定绕过策略的供应商或模型。分类提示词尽量只传必要的请求摘要与元数据；如果必须分析原文，应在隐私策略允许且明确受预算控制的前提下执行。

## 9. API 设计

### 9.1 客户端接口

#### `POST /v1/route`

纯决策接口，不执行模型生成。供 HXXDocQA Kit 在不同处理阶段调用。

请求：

```json
{
  "virtual_model": "hxx/docqa-auto",
  "task_type": "document_reasoning",
  "features": {
    "input_modality": ["text"],
    "estimated_tokens": 42000,
    "requires_long_context": true,
    "requires_json": false,
    "quality_preference": "quality",
    "budget_usd": 0.05
  },
  "metadata": {
    "app_id": "hxxdocqa"
  }
}
```

响应：

```json
{
  "request_id": "sr_01J...",
  "selected_model": "newapi-model-alias",
  "task_type": "document_reasoning",
  "pool": "long_context_docs",
  "policy": {
    "code": "docqa-default",
    "version": 3
  },
  "reason_code": "BEST_SCORE_WITHIN_BUDGET",
  "estimated_cost_usd": 0.031,
  "expires_at": "2026-10-21T06:00:30Z"
}
```

`selected_model` 是供 NewAPI 调用的模型别名，不是供应商密钥或内部连接字符串。可选地签发短期、带请求 ID 和策略版本的路由票据，防止调用方篡改所选模型；票据必须绑定租户、应用、有效期和预算。

#### `POST /v1/chat/completions`

- 接受 OpenAI Chat Completions 兼容请求。
- `model` 可为 `hxx/auto`、`hxx/docqa-auto` 等虚拟模型。
- 路由成功后，将 `model` 替换为已批准的 NewAPI 模型别名。
- 保留 `stream`、`messages`、`temperature`、`max_tokens` 等受支持字段。
- 不应盲目透传未知扩展字段；应明确允许列表。
- 路由层不应把隐藏的内部模型 ID 泄露给无权限客户端。

#### `GET /v1/models`

返回当前调用身份有权使用的虚拟模型，不直接暴露内部供应商和敏感模型配置。

### 9.2 管理 API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/admin/v1/models` | 列出/创建模型 |
| GET/PATCH | `/admin/v1/models/{id}` | 查看/修改模型 |
| GET/POST | `/admin/v1/pools` | 列出/创建模型池 |
| PUT | `/admin/v1/pools/{id}/members` | 设置模型池成员 |
| GET/POST | `/admin/v1/policies` | 查询/创建策略草稿 |
| POST | `/admin/v1/policies/{id}/validate` | 校验策略与依赖 |
| POST | `/admin/v1/policies/{id}/publish` | 发布策略 |
| POST | `/admin/v1/policies/{id}/rollback` | 回滚到上一发布版本 |
| POST | `/admin/v1/routes/test` | 不调用生成模型，仅模拟决策 |
| GET | `/admin/v1/decisions/{request_id}` | 查询决策解释 |
| GET | `/healthz` | 进程存活检查 |
| GET | `/readyz` | 依赖就绪检查 |
| GET | `/metrics` | Prometheus 指标，建议仅内网开放 |

### 9.3 错误响应格式

统一使用可机读错误码：

```json
{
  "error": {
    "code": "NO_ELIGIBLE_MODEL",
    "message": "No model satisfies the current routing constraints.",
    "request_id": "sr_01J...",
    "retryable": false
  }
}
```

## 10. 错误处理与故障切换

| 错误 | 处理方式 | 是否换模型 |
|---|---|---|
| 分类器超时/不可用 | 回退规则分类 | 通常不需要 |
| 无候选模型 | 返回明确错误并记录过滤原因 | 不得绕过硬约束 |
| NewAPI 连接失败 | 有界重试；可换备用候选 | 首个 token 前可以 |
| HTTP 429 | 遵守 Retry-After；预算与截止时间允许时重试 | 可尝试备用模型 |
| HTTP 5xx | 有界重试或切换候选 | 可以 |
| HTTP 400 参数错误 | 返回调用参数错误 | 通常不换模型 |
| 上下文超限 | 可按策略缩减上下文或选择更大窗口模型 | 可以，但要重新评估成本 |
| 输出格式校验失败 | 受限次数重试或升级 | 可以 |
| 客户端取消 | 取消下游请求 | 不可以继续 |
| 流式输出中途失败 | 终止流并记录不完整状态 | 不透明切换，避免重复输出 |
| DB 暂时不可用 | 使用最后一次有效配置快照；无法审计时按策略决定是否拒绝新请求 | 视安全策略 |

重试约束：

- 最大尝试次数可配置，建议首期最多 2 次模型执行尝试。
- 只对明确可重试错误进行重试。
- 设置总截止时间和总预算；不能每次重试都重新获得完整预算。
- 不能把 400、认证失败、权限拒绝等错误当成可重试错误。
- 只有幂等的纯推理请求才适合透明重试；带工具副作用的请求不在首期透明重试范围内。
- 一旦 SSE 已向客户端发出有效内容，默认不跨模型重启输出。

## 11. NewAPI 集成

### 11.1 集成原则

- SmartRouter 持有单独的 NewAPI 服务端 API Key。
- HXXBot 客户端不能直接访问该服务端 Key。
- NewAPI 中为 SmartRouter 配置仅允许调用所需模型的账号/令牌和额度。
- SmartRouter 只传递选定的模型别名，不接触真实供应商凭证。
- 计费对账以 NewAPI 实际用量记录为准；SmartRouter 的预算估算用于预筛选，不替代计费。
- 先验证当前 NewAPI 版本支持的端点、模型映射、usage 返回和流式行为，再确定生产适配器。

### 11.2 SSE 流式代理

- 请求设置 `stream: true` 时，代理必须逐块转发 `text/event-stream`。
- 关闭反向代理缓冲，及时 flush。
- 处理客户端断开并取消下游请求。
- 设定连接建立超时、首 token 超时、空闲读取超时和总请求截止时间。
- 流式 usage 可能只在结束前的最后一个 chunk 返回；若流中断，应将成本状态记为 `pending_reconciliation`，而不是 0。
- 仅在首个内容 chunk 前进行透明备用模型切换。

## 12. 安全、隐私与多租户

1. 管理 API 与业务 API 使用不同认证凭证。
2. 所有管理写操作需要 RBAC，并记录审计事件。
3. 租户 ID 从可信认证上下文取得，不能只信任客户端 JSON 字段。
4. 日志默认不保存 `messages`、文档全文、OCR 原文和回答。
5. 请求摘要若用于分类，应进行长度限制和敏感信息最小化。
6. 不把模型供应商 API Key 存入模型表；只保存 NewAPI 别名。
7. 为每个租户设置最大输入大小、调用速率、单次预算和日预算。
8. 通过允许列表限制上游 URL，避免用户可控地址导致 SSRF。
9. 配置发布前校验数据区域、模型能力、预算与权限约束。
10. 评测集和反馈数据应脱敏，并设置保留期限。

## 13. 测试方案

### 13.1 单元测试

- 任务规则分类：显式标签优先级、模态识别、长度边界。
- 候选过滤：禁用模型、上下文不足、预算超限、缺少视觉能力。
- 评分函数：权重归一化、平分排序、缺失数据处理。
- 成本计算：输入/输出价格、价格未知、输出 token 预留。
- 策略编译：非法 JSON、引用不存在的模型池、权重总和错误。
- 错误映射：NewAPI 错误转换成稳定错误码。

### 13.2 集成测试

使用 httptest 模拟 NewAPI：

- 普通非流式调用。
- SSE 正常结束与 usage chunk。
- 连接超时、429、500、非法 JSON。
- 首 token 前切换备用模型。
- 首 token 后连接中断不重复生成。
- 客户端取消传播。
- 分类器不可用时回退规则。
- DB 暂时不可用时使用最后有效策略快照。
- 多租户不能访问其他租户的策略或决策记录。

### 13.3 路由质量评测

建立 HXXDocQA 脱敏测试集，按任务类型分层：

- OCR 后处理与版面恢复。
- 表格/字段抽取。
- 长文档摘要。
- 基于检索片段的回答与引用。
- 合同风险与跨段落推理。
- Embedding 与 Reranker 专项任务。

每个样本用多个候选模型离线运行，记录质量评分、成本、延迟和结构化输出通过率。比较固定模型基线、规则路由、评分路由三种方案。

建议首期验收目标（内部工程目标，而非既有性能承诺）：

- 所有硬约束违规用例均不能选出不合规模型。
- 路由决策 P95 在本地规则路径下低于 50 ms（不含外部分类器调用和数据库冷启动）。
- 路由服务在测试负载下无数据竞争、无未受控重试。
- 分类器超时能在设定时间内回退。
- 流式中断不会导致自动重复输出。
- 对比固定模型基线，成本下降时，关键任务质量不能超过预先定义的容忍下降范围。

### 13.4 负载测试

使用 k6、vegeta 或自写 Go 压测程序测试：

- 纯 `/v1/route` 决策吞吐量。
- 配置热更新期间的并发读。
- 慢分类器对整体请求的影响。
- SSE 并发连接与内存使用。
- 数据库断连、NewAPI 限流时的降级表现。

## 14. 部署设计

### 14.1 单机/开发环境

```text
HXXDocQA Kit
    |
HXXSmartRouter :8090
    |           \
    |            MySQL
    |
NewAPI :3000
    |
LLM providers
```

首期可与现有服务部署在同一私有网络中。SmartRouter 的端口只允许 HXXBot 服务访问；管理端点不直接暴露公网。

### 14.2 Docker Compose 示例

```yaml
services:
  hxx-smart-router:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:8090:8090"
    environment:
      HXX_SR_DB_DSN: "${HXX_SR_DB_DSN}"
      HXX_SR_NEWAPI_KEY: "${HXX_SR_NEWAPI_KEY}"
      HXX_SR_SERVICE_TOKENS: "${HXX_SR_SERVICE_TOKENS}"
      HXX_SR_ADMIN_TOKENS: "${HXX_SR_ADMIN_TOKENS}"
    depends_on:
      mysql:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "/hxx-smart-router", "healthcheck"]
      interval: 15s
      timeout: 3s
      retries: 3
```

此片段假设 MySQL 由同一 Compose 项目或外部服务提供；若复用现有数据库，应删除该文件中的 `mysql` 服务依赖，并配置可达的 DSN。不要复制生产数据库密码或 NewAPI Key 到仓库。

### 14.3 生产运行要求

- 数据库使用独立账号，仅授权必要表权限。
- 配置 migration 先执行，应用进程不自动以高权限建表。
- 配置快照定期刷新，发布后可主动通知实例加载新版本。
- 运行至少两个实例之前，再引入 Redis 或其他共享健康状态机制。
- 配置备份、策略版本回滚与服务健康监控。
- 为 NewAPI 和 SmartRouter 分别设置请求超时，避免双层重试放大流量。

## 15. 里程碑与验收

### P0：基础骨架
- Go 服务、配置加载、健康检查、认证。
- MySQL migrations。
- NewAPI HTTP 客户端与请求 ID。
- 完成 `/v1/route` 基础响应。

### P1：规则路由
- 模型注册表、模型池、虚拟模型、策略编译。
- 规则分类、硬约束过滤、评分排序。
- 决策审计与测试接口。
- HXXDocQA 的 `document_extraction`、`document_reasoning`、`rag_answer` 任务路由。

### P2：调用代理
- OpenAI 兼容 Chat Completions。
- SSE 代理、取消传播、首 token 前有限重试。
- NewAPI 计费记录对账流程。

### P3：轻量分类
- 低置信度触发分类器。
- 结构化输出校验、超时与成本限制。
- 分类器不可用时回退规则。

### P4：运营与评测
- 管理后台的模型池与策略配置。
- 路由测试台、决策解释、灰度发布。
- HXXDocQA 脱敏基准集与成本/质量报告。

### MVP 完成定义

1. 可在后台配置至少 10 个模型和多个模型池。
2. 同一模型可加入多个池。
3. 客户端调用虚拟模型即可自动选择真实模型。
4. 每次决策都能说明候选筛选和选择理由。
5. 分类器不可用时系统不会失控或无限重试。
6. NewAPI 仍是唯一上游调用与计费网关。
7. 支持策略发布、回滚、审计和基础监控。
8. HXXDocQA 的不同任务类型能够走不同的候选池和策略。

## 16. 推荐默认策略

| 任务 | 默认池 | 默认策略 |
|---|---|---|
| `document_classification` | `cheap_general` | 成本优先 |
| `document_extraction` | `structured_output` | 质量与 JSON 合规优先 |
| `document_ocr_postprocess` | `long_context_docs` | 文本保真与结构恢复优先 |
| `document_summarization` | `long_context_docs` | 均衡 |
| `document_reasoning` | `reasoning_premium` | 质量优先，预算硬约束 |
| `rag_query_rewrite` | `cheap_general` | 低延迟/低成本 |
| `rag_answer` | `rag_answer_pool` | 引用遵循与质量优先 |
| `embedding` | `embedding_pool` | 只允许 embedding 能力模型 |
| `reranking` | `reranker_pool` | 只允许 reranker 能力模型 |
| `vision_document_understanding` | `vision_docs` | 视觉能力硬约束 |

这些池名是初始建议。具体模型应通过你实际已配置的 NewAPI 模型别名、价格、能力和基准测试结果填入，不能仅凭模型名称假定其具备某项能力。

## 17. 参考资料

- NewAPI 项目及其 API、渠道、模型映射和用量能力：<https://github.com/QuantumNous/new-api>
- vLLM Semantic Router 架构与控制面/数据面设计：<https://github.com/vllm-project/semantic-router>
- vLLM Semantic Router 模型选择算法说明：<https://github.com/vllm-project/semantic-router/blob/main/src/semantic-router/pkg/modelselection/README.md>
- OpenAI Chat Completions API 与流式 usage 说明：<https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create>

参考项目的具体能力、许可证和版本会变化。正式集成前，应针对选定的 release/tag 核对文档和兼容性；本方案并不要求直接依赖 Semantic Router 的运行时。
