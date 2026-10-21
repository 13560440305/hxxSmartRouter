# HXXSmartRouter 详细技术设计

- 版本：V1.2
- 日期：2026-10-21
- 状态：MVP 实施基线（基于 V1.1 完善）
- 首个场景：HXXDocQA Kit（复杂文档解析、OCR、RAG、问答）
- 技术路线：Go + MySQL；规则筛选 + 评分排序 + 必要时轻量分类；可插拔单模式执行后端
- 变更摘要（相对 V1.1）：
  - 引入可插拔执行后端：`newapi` | `openai_compatible` | `direct`
  - **单模式运行**：同一进程只启用一种执行后端；通过配置文件选择，修改后必须重启
  - 不支持多模式混合、不支持热切换、不支持按租户混用执行模式
  - 兼容任意 OpenAI Chat Completions 兼容网关（NewAPI、OneAPI、LiteLLM 等）
  - 直连模式（TOB）最小渠道与凭证模型；路由核心与执行后端解耦
  - 产品定位从「依赖 NewAPI」调整为「可选依赖统一网关，也可独立直连」

---

## 1. 产品定位

HXXSmartRouter 是 HXX 生态的独立**模型决策与策略服务**，负责判断“当前任务应该使用哪个模型”，并按配置的**单一执行后端**完成调用。

调用方主要面向虚拟模型与任务意图；SmartRouter 按策略选出合适模型，再交由当前启用的执行后端（统一网关或直连供应商）执行。

### 1.1 目标

1. 管理模型元数据、模型池、虚拟模型入口和版本化路由策略。
2. 根据任务类型、输入模态、上下文要求、预算、质量要求和健康状态筛选候选模型。
3. 使用可解释评分选择模型，并记录评分明细。
4. 规则无法可靠识别任务时，按需调用轻量分类模型。
5. 记录路由决策、实际模型、延迟、错误和成本估算，支持回放、灰度和回滚。
6. 为 HXXDocQA Kit 的 OCR 后处理、文档结构化、Embedding、Rerank、RAG 问答等不同任务提供路由。
7. 支持三种**调用模式**（智能路由 / 虚拟模型 / 透传指定），默认引导使用智能路由，透传仍受硬约束。
8. 支持三种**执行后端**（单选）：NewAPI、任意 OpenAI 兼容网关、供应商直连；配置文件指定，重启生效。

### 1.2 非目标

- 不实现 OCR、PDF 解析、切片、向量数据库或 RAG 本身。
- 不在首期训练自己的分类器或学习型路由器。
- 不实现通用工作流/Agent 编排。
- 不默认存储原始文档、完整提示词和模型输出。
- **不在同一进程内混合多种执行后端**；不提供执行模式的热切换或按请求/租户动态切换。
- 直连模式下不做完整多渠道计费中心与复杂供应商编排（可后置）；网关模式下不复制网关已有的计费与渠道重试。

### 1.3 执行后端与职责边界

进程启动时通过配置选择**唯一**执行模式：

| 模式 | 适用场景 | 上游 | 凭证与渠道 | 计费权威 |
|------|----------|------|------------|----------|
| `newapi` | 已有 NewAPI | NewAPI | NewAPI 管理 | NewAPI |
| `openai_compatible` | OneAPI / LiteLLM / 其它 OpenAI 兼容网关 | 兼容网关 base_url | 网关侧管理 | 网关（若提供 usage） |
| `direct` | TOB、无统一网关、自管少量供应商 | 各厂商 API | SmartRouter 配置/DB | SmartRouter 记录用量（完整账单可后置） |

**共同原则**：

- 路由、策略、评分、决策审计与执行模式无关，一套逻辑。
- SmartRouter 负责「选哪个模型 + 决策审计 + 首 token 前有限模型 failover」。
- 网关模式下：渠道级重试、连接池、供应商降级交给上游网关，避免双重重试。
- 直连模式下：由 SmartRouter 执行层做有限重试与超时；不做复杂多渠道调度（MVP）。

```text
[ 路由引擎：分类 / 硬过滤 / 评分 / 决策 ]
                    │
                    │  selected_model + 请求
                    ▼
[ 唯一 Executor（启动时由 execution.mode 决定） ]
    ├─ newapi              → NewAPIExecutor
    ├─ openai_compatible   → OpenAICompatibleExecutor
    └─ direct              → DirectProviderExecutor
```

---

## 2. 关键设计决策

| 决策 | 方案 |
|------|------|
| 主语言 | Go |
| HTTP | `net/http` + `chi`（也可统一使用团队现有轻量框架） |
| 数据库 | 优先 MySQL 8；若新项目统一 PostgreSQL，也可替换 |
| ORM | `sqlc` 或手写 `database/sql`；避免核心查询被复杂 ORM 隐藏 |
| 配置热更新 | **策略/模型目录**：DB 发布版本 + 进程内不可变快照；**执行模式**：仅配置文件，改后重启 |
| 缓存 | 首期内存缓存；多副本时可选 Redis |
| 执行后端 | 单模式：`newapi` \| `openai_compatible` \| `direct` |
| 认证 | 服务间 Bearer Token；管理 API 独立权限 |
| 观测 | 结构化 JSON 日志、Prometheus 指标、request_id / decision_id；标签含 `execution_mode` |
| 部署 | 单个 Go 二进制 + MySQL（+ 可选上游网关） |
| 分类器 | 规则优先；低置信度时调用指定的小模型；超时则回退规则 |
| 健康状态 | 进程内滑动窗口为主，异步落库；多实例后再考虑共享存储 |

---

## 3. 组件与请求生命周期

```text
HXXDocQA Kit / 其他调用方
    |
    | POST /v1/chat/completions 或 POST /v1/route
    | model = hxx/docqa-auto | hxx/xxx | 真实别名
    v
HXXSmartRouter
    1. Auth / Tenant / Quota Guard
    2. Normalize Request
    3. Resolve Call Mode（auto / virtual / forced）
    4. Resolve Virtual Model（若适用）
    5. Extract Features
    6. Rule Classification
    7. Optional Lightweight Classifier
    8. Candidate Hard Filters
    9. Candidate Scoring（含 breakdown）
   10. Persist Decision（decision_id + metadata）
   11. Forward via 当前唯一 Executor
       （仅首 token 前允许有限 failover）
    |
    v
Executor（newapi / openai_compatible / direct）
    |
    v
上游模型服务
```

### 3.1 三种调用模式（与执行后端无关）

| 模式 | `model` 取值示例 | 行为 |
|------|------------------|------|
| 智能路由（主流） | `hxx/auto`、`hxx/docqa-auto` | 按策略 + 任务特征自动选模 |
| 虚拟模型 | `hxx/docqa-extract` 等 | 走该虚拟模型绑定的默认策略/任务类型 |
| 透传指定（保留） | 真实模型别名 | 不跑评分选模，但**仍做**租户权限、能力、预算、健康等硬过滤 |

透传不满足硬约束时返回 `MODEL_NOT_ALLOWED` 或 `NO_ELIGIBLE_MODEL`。响应元数据标注 `routing_mode: auto | virtual | forced`。

### 3.2 执行模式切换约定

- **仅配置文件**（或环境变量）指定 `execution.mode`。
- **修改后必须重启**进程方可生效。
- 不提供管理 API「一键切换执行模式」。
- 不支持同一进程内多模式、不支持按租户/按请求选择执行后端。
- 启动时若当前 mode 所需配置不完整（如直连无可用渠道），应启动失败或 `/readyz` 失败。

---

## 4. HXXDocQA Kit 的任务分类体系

| task_type | 说明 | 常见能力要求 |
|-----------|------|--------------|
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

OCR 引擎本身通常是独立服务。SmartRouter 只负责需要模型推理的 OCR 后处理、版面理解或视觉理解选型。

**调用约定**：HXXDocQA 各阶段应强制或强烈建议传入显式 `task_type`。Embedding / Rerank 与 Chat 通过能力标记 + 池隔离双重保证。

---

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
│   │   ├── executor.go          # 接口定义
│   │   ├── factory.go           # 按 mode 构造唯一实现
│   │   ├── newapi.go
│   │   ├── openai_compatible.go
│   │   ├── direct.go
│   │   ├── sse.go
│   │   └── retry.go
│   ├── persistence/
│   │   ├── mysql.go
│   │   ├── model_repo.go
│   │   ├── policy_repo.go
│   │   ├── decision_repo.go
│   │   └── channel_repo.go      # direct 模式
│   ├── telemetry/
│   │   ├── logger.go
│   │   ├── metrics.go
│   │   └── tracing.go
│   └── security/
│       ├── secrets.go
│       ├── ticket.go
│       └── redaction.go
├── migrations/
│   ├── 001_init.sql
│   ├── 002_seed_docqa.sql
│   └── 003_channels_direct.sql  # direct 模式相关表
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

- `domain` 不依赖数据库、HTTP 框架或具体 Executor。
- `routing` 依赖领域接口，不直接操作 SQL，不感知执行模式细节。
- `executor` 实现上游调用；由 `factory` 按配置只构造一种实现。
- `persistence` 实现仓储；`channel_repo` 仅在 `direct` 模式下使用。
- `transport` 只做 DTO 校验、认证和调用应用服务。
- `policy/compiler.go` 在发布时把策略编译成运行时快照，热路径不查数据库。

---

## 6. 数据库 DDL（MySQL 8）

生产迁移通过版本化 migration 执行；价格用 `DECIMAL`，时间统一 UTC，JSON 由应用层严格校验。

### 6.1 核心表（所有执行模式共用）

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
  upstream_model VARCHAR(192) NOT NULL COMMENT '网关模式：网关内模型别名；直连模式：供应商模型名',
  channel_id BIGINT UNSIGNED NULL COMMENT '仅 direct 模式：关联 sr_channels',
  capabilities JSON NOT NULL COMMENT '固定枚举，如 ["chat","long_context","json","embedding","rerank","vision"]',
  context_window INT UNSIGNED NULL,
  max_output_tokens INT UNSIGNED NULL,
  input_price_per_million DECIMAL(18,8) NULL,
  output_price_per_million DECIMAL(18,8) NULL,
  supports_stream TINYINT(1) NOT NULL DEFAULT 1,
  supports_vision TINYINT(1) NOT NULL DEFAULT 0,
  supports_json_mode TINYINT(1) NOT NULL DEFAULT 0,
  quality_score DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
  task_quality_scores JSON NULL COMMENT '按 task_type 的质量分',
  reliability_score DECIMAL(5,4) NOT NULL DEFAULT 0.9500,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_models_code (code),
  KEY idx_sr_models_provider (provider_id, enabled),
  KEY idx_sr_models_channel (channel_id),
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
  task_affinity JSON NULL,
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
  scope VARCHAR(32) NOT NULL DEFAULT 'global',
  tenant_id VARCHAR(96) NULL,
  created_by VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_policy_code_version (code, version),
  KEY idx_sr_policy_status (status, code),
  KEY idx_sr_policy_scope (scope, tenant_id, status)
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
  decision_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(96) NULL,
  app_id VARCHAR(96) NULL,
  routing_mode VARCHAR(16) NOT NULL COMMENT 'auto|virtual|forced',
  execution_mode VARCHAR(32) NOT NULL COMMENT '启动时的 execution.mode 快照',
  virtual_model VARCHAR(96) NULL,
  task_type VARCHAR(64) NOT NULL,
  difficulty VARCHAR(16) NULL,
  policy_code VARCHAR(96) NULL,
  policy_version INT UNSIGNED NULL,
  selected_model_id BIGINT UNSIGNED NULL,
  selected_model_code VARCHAR(96) NULL,
  candidate_summary JSON NULL,
  reason_code VARCHAR(64) NOT NULL,
  estimated_input_tokens INT UNSIGNED NULL,
  estimated_cost DECIMAL(18,8) NULL,
  actual_cost DECIMAL(18,8) NULL,
  latency_ms INT UNSIGNED NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'decided',
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_route_decisions_decision (decision_id),
  KEY idx_sr_decisions_request (request_id),
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

### 6.2 直连模式表（仅 `execution.mode=direct` 使用）

```sql
CREATE TABLE sr_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(96) NOT NULL,
  name VARCHAR(128) NOT NULL,
  protocol VARCHAR(32) NOT NULL DEFAULT 'openai_chat' COMMENT 'openai_chat|...',
  base_url VARCHAR(512) NOT NULL,
  auth_type VARCHAR(32) NOT NULL DEFAULT 'bearer',
  credential_ref VARCHAR(192) NOT NULL COMMENT '环境变量名或密钥引用，不存明文 Key',
  extra_headers JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  timeout_ms INT UNSIGNED NOT NULL DEFAULT 90000,
  max_retries INT UNSIGNED NOT NULL DEFAULT 1,
  description VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_sr_channels_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

说明：

- `sr_models.channel_id` 在 `direct` 下指向渠道；网关模式下可为空，仅用 `upstream_model`。
- Key **不入库明文**，只存 `credential_ref`（如环境变量名）。
- MVP 直连：一模型一渠道即可；多渠道主备可后置。

### 6.3 DDL 实施注意事项

1. 网关模式：`upstream_model` = 网关暴露的模型名；不存供应商密钥。
2. 直连模式：`upstream_model` = 供应商 API 的模型名；`channel_id` 必填且启用。
3. `capabilities` 使用固定枚举，应用层校验。
4. `quality_score` / `task_quality_scores`：评分优先任务分。
5. `candidate_summary` 不保存用户全文；含评分 breakdown 与过滤原因。
6. `decision_id` 唯一标识一次决策；`request_id` 可对应多次决策。
7. `execution_mode` 写入决策记录，便于审计当时运行模式。
8. 健康表热路径以进程内为准，异步落库。
9. 策略发布须做 schema、引用、权重归一、池可用性校验。
10. 切换执行模式（改配置重启）前，应确认启用中的模型在目标模式下均有合法上游映射。

---

## 7. 配置结构

### 7.1 服务配置 `config.yaml`

```yaml
server:
  listen: "127.0.0.1:8090"
  read_timeout: 10s
  write_timeout: 0s
  idle_timeout: 90s
  max_body_bytes: 20971520

database:
  driver: mysql
  dsn: "${HXX_SR_DB_DSN}"
  max_open_conns: 20
  max_idle_conns: 5
  conn_max_lifetime: 30m

# ========== 执行后端：三选一，改后必须重启 ==========
execution:
  mode: newapi   # newapi | openai_compatible | direct

  newapi:
    base_url: "http://newapi:3000"
    api_key_env: "HXX_SR_NEWAPI_KEY"
    timeout: 90s
    connect_timeout: 3s
    max_retries_before_stream: 1

  openai_compatible:
    base_url: "http://other-gateway:8080/v1"
    api_key_env: "HXX_SR_UPSTREAM_KEY"
    timeout: 90s
    connect_timeout: 3s
    max_retries_before_stream: 1
    # 可选兼容差异
    model_prefix: ""
    trust_usage: true

  direct:
    default_timeout: 90s
    connect_timeout: 3s
    max_retries: 1
    # 渠道与 credential_ref 见 DB sr_channels；Key 由环境变量注入

security:
  service_tokens_env: "HXX_SR_SERVICE_TOKENS"
  admin_tokens_env: "HXX_SR_ADMIN_TOKENS"
  trust_forwarded_headers: false
  log_prompt_content: false
  route_ticket_ttl: 30s
  route_ticket_signing_key_env: "HXX_SR_TICKET_KEY"

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
  max_model_failover_attempts: 2

telemetry:
  metrics_enabled: true
  metrics_path: "/metrics"
  log_level: "info"
  log_format: "json"
```

要点：

- `execution.mode` 决定进程内唯一 Executor；其它 mode 配置段可保留但不加载。
- **修改 `execution.mode` 或对应上游连接后必须重启**。
- 生产密钥不进 Git；`fail_open_to_default_model` 默认 false。

### 7.2 路由策略配置示例

```json
{
  "version": 1,
  "strategy": "weighted_score",
  "weights": {
    "quality": 0.40,
    "cost": 0.25,
    "latency": 0.15,
    "reliability": 0.10,
    "affinity": 0.10
  },
  "constraints": {
    "max_estimated_cost_usd": 0.05,
    "require_enabled": true,
    "require_healthy": true,
    "allow_unknown_price": false
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
  },
  "task_weight_overrides": {
    "document_reasoning": {
      "quality": 0.55,
      "cost": 0.15,
      "latency": 0.10,
      "reliability": 0.10,
      "affinity": 0.10
    },
    "rag_query_rewrite": {
      "quality": 0.20,
      "cost": 0.40,
      "latency": 0.30,
      "reliability": 0.05,
      "affinity": 0.05
    }
  }
}
```

---

## 8. 执行后端设计

### 8.1 接口（示意）

```go
type ChatRequest struct {
    Model          string
    Messages       []Message
    Stream         bool
    MaxTokens      *int
    Temperature    *float64
    ResponseFormat json.RawMessage
    // 允许列表内的其它字段
}

type Executor interface {
    Name() string // newapi | openai_compatible | direct
    ChatCompletion(ctx context.Context, req ChatRequest) (*ChatResponse, error)
    ChatCompletionStream(ctx context.Context, req ChatRequest) (Stream, error)
    // 可选：健康探测
    Ping(ctx context.Context) error
}
```

启动时：

```go
exec, err := executor.NewFromConfig(cfg.Execution)
// 仅构造 cfg.Execution.Mode 对应的一种实现
```

### 8.2 `newapi` / `openai_compatible`

- 均走 OpenAI Chat Completions 兼容协议。
- 差异主要在 base_url、鉴权环境变量、可选 model 前缀、usage 是否可信。
- 任意兼容 NewAPI 协议的网关（OneAPI、LiteLLM Proxy、自建兼容层等）优先用 `openai_compatible`，无需改路由代码。
- 协议细节差异（流式 usage 位置、429 头、JSON mode）在适配器内消化。

### 8.3 `direct`

- 从 `sr_channels` + `credential_ref` 解析上游。
- MVP：单渠道 per 模型、有限重试、SSE 转发。
- 不在此模式实现完整多供应商计费与复杂编排。
- Key 仅通过环境变量/密钥系统注入。

### 8.4 切换与校验

1. 修改 `config.yaml` 中 `execution.mode`（及对应段）。
2. 确认模型表在目标模式下映射完整。
3. **重启**进程。
4. 检查 `/readyz` 与日志中的 `execution_mode`。

---

## 9. 路由算法

### 9.1 标准流程

1. 认证、租户、权限、请求大小、预算。租户 ID 仅从认证上下文取得。
2. 解析调用模式：auto / virtual / forced。
3. 透传：硬过滤后生成决策；不满足则明确错误。
4. 解析虚拟模型。
5. 抽取特征。
6. 规则分类；低置信度时可选轻量分类器（有超时与次数限制）。
7. 匹配路由规则 → 目标池。
8. 硬条件过滤。
9. 评分（含 breakdown）排序。
10. 持久化决策（含 `execution_mode` 快照）。
11. 经当前唯一 Executor 调用上游；首 token 前有限 failover。
12. 记录执行结果与用量。

### 9.2 特征抽取

```go
type RequestFeatures struct {
    VirtualModel       string
    TaskType           string
    Difficulty         string
    InputModality      []string
    EstimatedTokens    int
    SystemPromptTokens int
    RequiresVision     bool
    RequiresJSON       bool
    RequiresLongCtx    bool
    QualityPreference  string
    BudgetUSD          float64
    TenantID           string
    AppID              string
    MessageTurns       int
    HasTools           bool
    LanguageHint       string
}
```

### 9.3 规则分类优先级

1. 调用方显式任务标签（DocQA 各阶段应传）。
2. 虚拟模型默认任务类型。
3. 处理阶段传入的任务类型（embedding / reranking 等）。
4. 可解释规则（图片、JSON、长度、OCR 标记等）。
5. 轻量分类模型。
6. 失败时安全默认；无合适模型则明确报错。

任务标签不能覆盖权限、预算与能力硬约束。

### 9.4 硬条件过滤

- 模型 / 供应商 / 池成员启用。
- 具备任务所需能力；Embedding/Rerank 不得进普通聊天模型。
- 上下文窗口足够（含系统/模板开销与预留输出）。
- 预计成本不超预算；未知价格按策略排除。
- 健康状态非 open/cooldown。
- 租户与区域等约束。
- 透传时：租户是否授权该模型。
- **direct**：关联渠道启用且 `credential_ref` 可解析。

全部不满足 → `NO_ELIGIBLE_MODEL` / `MODEL_NOT_ALLOWED`，不放宽硬约束。

### 9.5 评分公式

```text
score =
    w_quality     * quality_score(task)
  + w_cost        * cost_score
  + w_latency     * latency_score
  + w_reliability * reliability_score
  + w_affinity    * task_affinity_score
```

权重非负且和为 1。缺失指标用中性默认并在 breakdown 标注。

### 9.6 成本估算

```text
estimated_cost =
  (estimated_input_tokens + system_prompt_tokens) / 1e6 * input_price
+ reserved_output_tokens / 1e6 * output_price
```

网关模式实际成本以网关 usage 为准；直连模式以响应 usage 或本地估算记入，完整计费可后置。流式中断记 `pending_reconciliation`。

### 9.7 轻量分类器协议

```json
{
  "task_type": "document_reasoning",
  "difficulty": "high",
  "requires_vision": false,
  "requires_long_context": true,
  "confidence": 0.84
}
```

不得返回模型名或池名。

### 9.8 决策与执行一致性

- `/v1/route` 可返回短期 `expires_at` 或签名票据。
- 代理路径在同一次请求内完成决策与转发。

---

## 10. API 设计

### 10.1 `POST /v1/route`

纯决策，不执行生成。

请求示例：

```json
{
  "virtual_model": "hxx/docqa-auto",
  "task_type": "document_reasoning",
  "features": {
    "input_modality": ["text"],
    "estimated_tokens": 42000,
    "requires_long_context": true,
    "quality_preference": "quality",
    "budget_usd": 0.05
  },
  "metadata": {
    "app_id": "hxxdocqa",
    "request_id": "biz_01J..."
  }
}
```

响应示例：

```json
{
  "decision_id": "dec_01J...",
  "request_id": "biz_01J...",
  "routing_mode": "auto",
  "execution_mode": "newapi",
  "selected_model": "model-alias",
  "task_type": "document_reasoning",
  "pool": "long_context_docs",
  "policy": { "code": "docqa-default", "version": 3 },
  "reason_code": "BEST_SCORE_WITHIN_BUDGET",
  "estimated_cost_usd": 0.031,
  "expires_at": "2026-10-21T06:00:30Z"
}
```

### 10.2 `POST /v1/chat/completions`

OpenAI 兼容；`model` 为虚拟或真实别名；成功后经当前 Executor 调用；标注 `routing_mode`。

### 10.3 `GET /v1/models`

返回当前身份可用的虚拟模型（及可选允许透传列表）。

### 10.4 管理 API

| 方法 | 路径 | 用途 |
|------|------|------|
| GET/POST | `/admin/v1/models` | 模型 |
| GET/PATCH | `/admin/v1/models/{id}` | 模型详情/修改 |
| GET/POST | `/admin/v1/pools` | 模型池 |
| PUT | `/admin/v1/pools/{id}/members` | 池成员 |
| GET/POST | `/admin/v1/channels` | 渠道（仅 direct 有意义） |
| GET/POST | `/admin/v1/policies` | 策略草稿 |
| POST | `/admin/v1/policies/{id}/validate` | 校验 |
| POST | `/admin/v1/policies/{id}/publish` | 发布 |
| POST | `/admin/v1/policies/{id}/rollback` | 回滚 |
| POST | `/admin/v1/routes/test` | 模拟决策 + breakdown |
| GET | `/admin/v1/decisions/{decision_id}` | 决策解释 |
| GET | `/healthz` | 存活 |
| GET | `/readyz` | 就绪（含当前 Executor 可连通性） |
| GET | `/metrics` | Prometheus |

**不提供**通过管理 API 切换 `execution.mode` 的接口。

### 10.5 错误格式

```json
{
  "error": {
    "code": "NO_ELIGIBLE_MODEL",
    "message": "No model satisfies the current routing constraints.",
    "request_id": "sr_01J...",
    "decision_id": "dec_01J...",
    "retryable": false
  }
}
```

---

## 11. 错误处理与故障切换

| 错误 | 处理 | 换模型 |
|------|------|--------|
| 分类器超时/不可用 | 回退规则 | 通常否 |
| 无候选模型 | 明确错误 + 过滤原因 | 禁止放宽硬约束 |
| 上游连接失败 | 有界重试；可换候选 | 首 token 前可以 |
| 429 | 遵守 Retry-After | 可尝试备用 |
| 5xx | 有界重试或换候选 | 可以 |
| 400 | 返回参数错误 | 通常否 |
| 上下文超限 | 缩上下文或更大窗口模型 | 可以，重估成本 |
| 客户端取消 | 取消下游 | 否 |
| 流式中途失败 | 终止流 | 不透明跨模型切换 |
| DB 不可用 | 最后有效策略快照；从未加载成功则拒绝 | 视策略 |

- 模型尝试次数可配置，建议 ≤ 2。
- 网关模式：渠道级重试交给网关。
- 直连模式：执行层有限重试，不叠加无限重试。
- SSE 已输出有效内容后默认不跨模型重启。

---

## 12. 安全、隐私与多租户

1. 管理 API 与业务 API 凭证分离；写操作 RBAC + 审计。
2. 租户 ID 仅来自认证上下文。
3. 日志默认不落 messages / 文档全文。
4. 分类摘要长度限制与脱敏。
5. 网关模式不存供应商 Key；直连模式只存 `credential_ref`。
6. 租户级输入大小、速率、单次/日预算。
7. 上游 URL 允许列表，防 SSRF。
8. 策略发布前校验能力与权限约束。
9. 路由票据密钥与上游 Key 隔离。

---

## 13. 测试方案

### 13.1 单元测试

- 规则分类、硬过滤、评分与 breakdown、成本、策略编译。
- 调用模式解析；Executor factory 只构造对应 mode。
- 直连：缺 channel / 无效 credential_ref 时拒绝。

### 13.2 集成测试

- 分别在三种 `execution.mode` 下跑通 chat 与 stream（可用 mock 上游）。
- 改 mode 后未重启仍用旧 Executor（文档约定；测试可验证启动绑定）。
- 分类器回退、DB 快照、透传硬约束、取消传播、首 token 前 failover。

### 13.3 路由质量与负载

- 与 V1.1 相同：脱敏评测集、硬约束零漏选、决策 P95、压测 `/v1/route` 与 SSE。

---

## 14. 部署设计

### 14.1 拓扑示例

**网关模式（newapi / openai_compatible）**

```text
调用方 → HXXSmartRouter → NewAPI 或兼容网关 → 供应商
                ↓
              MySQL
```

**直连模式（direct）**

```text
调用方 → HXXSmartRouter → 供应商 API
                ↓
              MySQL（含 sr_channels）
```

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
      HXX_SR_TICKET_KEY: "${HXX_SR_TICKET_KEY}"
    volumes:
      - ./configs/config.yaml:/app/config.yaml:ro
    healthcheck:
      test: ["CMD", "/hxx-smart-router", "healthcheck"]
      interval: 15s
      timeout: 3s
      retries: 3
```

### 14.3 生产要求

- 独立 DB 账号与最小权限。
- migration 先于应用启动。
- 策略快照轮询/通知；**执行模式仅重启生效**。
- 指标与日志带 `execution_mode`。
- 切换 mode 的运维 runbook：改配置 → 校验模型映射 → 重启 → 检查 readyz。

---

## 15. 可观测性

| 类别 | 指标 |
|------|------|
| 决策 | 延迟 P50/P95；task_type；routing_mode；execution_mode |
| 过滤 | 原因 TopN |
| 选模 | 选用率、failover 次数、reason_code |
| 成本 | 估算 vs 实际上游 usage |
| 健康 | 成功率、P95、cooldown |
| 分类 | 规则命中率、LLM 分类超时率 |
| 运营 | 策略发布/回滚次数 |

---

## 16. 里程碑与验收

### P0：基础骨架

- 配置加载（含 `execution.mode`）、健康检查、认证。
- MySQL migrations；Executor 工厂与至少一种实现（建议 `openai_compatible` 或 `newapi`）。
- `/v1/route`；三种调用模式解析。

### P1：规则路由

- 模型/池/虚拟模型/策略编译与发布校验。
- 规则分类、硬过滤、评分 + breakdown。
- 决策审计与 routes/test。
- DocQA 核心 task_type 路由。

### P2：调用代理与第二执行后端

- Chat Completions + SSE；首 token 前 failover。
- 第二种 mode（如从 newapi 扩展到 openai_compatible，或补齐 direct 最小集）。
- 透传硬约束生效。

### P3：轻量分类 + direct 完善

- 分类器超时与回退。
- direct：渠道管理 API、credential_ref 校验。

### P4：运营与评测

- 决策解释、灰度、脱敏基准与成本/质量报告。

### MVP 完成定义

1. 可配置 ≥10 模型与多池；虚拟模型自动选模；透传受约束。
2. 每次决策可解释（含 breakdown）；分类器失败不失控。
3. **单执行模式**由配置决定，重启切换；路由核心与 Executor 解耦。
4. 至少一种网关模式与直连模式之一在联调环境可用。
5. 策略发布/回滚/审计/基础监控就绪。
6. 硬约束零漏选；流式中断不重复输出。

---

## 17. 推荐默认策略（任务 → 池）

| 任务 | 默认池 | 策略倾向 |
|------|--------|----------|
| `document_classification` | `cheap_general` | 成本优先 |
| `document_extraction` | `structured_output` | 质量与 JSON 合规 |
| `document_ocr_postprocess` | `long_context_docs` | 保真与结构 |
| `document_summarization` | `long_context_docs` | 均衡 |
| `document_reasoning` | `reasoning_premium` | 质量优先 + 预算硬约束 |
| `rag_query_rewrite` | `cheap_general` | 低延迟/低成本 |
| `rag_answer` | `rag_answer_pool` | 引用与质量 |
| `embedding` | `embedding_pool` | 仅 embedding |
| `reranking` | `reranker_pool` | 仅 rerank |
| `vision_document_understanding` | `vision_docs` | 视觉硬约束 |

具体模型按实际别名、价格与评测填入。

---

## 18. 参考资料

- NewAPI：https://github.com/QuantumNous/new-api
- vLLM Semantic Router：https://github.com/vllm-project/semantic-router
- OpenAI Chat Completions：https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

集成前请核对目标网关/供应商的 release 文档与兼容性差异。

---

## 附录 A：版本变更摘要

### V1.2 相对 V1.1

| 项 | 说明 |
|----|------|
| 执行后端 | `newapi` \| `openai_compatible` \| `direct`，可插拔 |
| 单模式 | 配置文件选择，**改后重启**；无热切换、无多模式混合 |
| TOB / 无网关 | `direct` + `sr_channels` + credential_ref |
| 兼容网关 | 任意 OpenAI 兼容平台走 `openai_compatible` |
| 决策字段 | 增加 `execution_mode` |
| 定位 | 可选依赖统一网关，亦可独立直连；路由核心不变 |

### V1.1 相对 V1.0（沿用）

- 三种调用模式；decision_id；NewAPI 重试边界；评分 breakdown；任务质量分/亲和分；策略发布校验；路由票据；健康进程内为主；多租户预留；成本含模板开销；可观测性增强。
