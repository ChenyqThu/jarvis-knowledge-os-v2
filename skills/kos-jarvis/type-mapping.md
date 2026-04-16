# KOS 9 types ↔ GBrain 20 dirs 映射

GBrain 用**目录**表达类型（MECE 强约束），KOS 用 frontmatter `kind` 字段。
本表定义导入/编译时两者的转换规则，同时规定导入时的 frontmatter 保留策略。

## 基本原则

1. **GBrain 目录是 canonical placement**（决定文件落在哪个目录）
2. **KOS `kind` 字段保留在 frontmatter**（决定 dikw-compile / evidence-gate /
   kos-lint 用什么规则检查这一页）
3. **两者同时存在**：一页既有 GBrain dir 决定的物理位置，也有 KOS kind
   决定的质量管控 profile

## 映射表

| KOS `kind` | GBrain dir | 备注 |
|-----------|-----------|------|
| `source` | `sources/` | 1:1。原始来源材料 |
| `entity` (person) | `people/` | 导入时根据 `tags: [person]` 或身份字段判断 |
| `entity` (company) | `companies/` | 根据 `tags: [company/organization]` |
| `entity` (system/tool) | `concepts/` | 软件系统视为 concept，不是 company |
| `entity` (project-system) | `projects/` | 有 repo/spec/team 的系统入 projects |
| `concept` | `concepts/` | 1:1 |
| `project` | `projects/` | 1:1 |
| `decision` | `concepts/` + `kind: decision` | GBrain `deals/` 只覆盖金融交易，
其他决策入 concepts 并靠 kind 字段区分 |
| `synthesis` | `writing/` 或 `concepts/` | 勉强散文形式 → writing；
距离"能当讲义教"更近 → concepts |
| `comparison` | `writing/` + `kind: comparison` | 比较型综述视为 writing
的特殊形态 |
| `protocol` | `concepts/` + `kind: protocol` | 或 `org/` 如果是机构流程 |
| `timeline` | 拆散到实体 `people/` 或 `companies/` 页面内的 Timeline 段 | GBrain 的
timeline 是每页一段，不是独立类型。KOS 的 timeline-*.md 按主实体拆分 |

## 导入时的处理逻辑（Week 4 用）

```
for each KOS .md:
  parse frontmatter
  switch (kind):
    case 'source': target_dir = 'sources/'
    case 'concept': target_dir = 'concepts/'
    case 'project': target_dir = 'projects/'
    case 'entity':
      if 'person' in tags: target_dir = 'people/'
      elif 'company' in tags or 'organization' in tags: target_dir = 'companies/'
      elif has_repo_or_team: target_dir = 'projects/'
      else: target_dir = 'concepts/'
    case 'decision': target_dir = 'concepts/'; preserve kind
    case 'synthesis':
      if length > 800 and has_narrative_tone: target_dir = 'writing/'
      else: target_dir = 'concepts/'
    case 'comparison': target_dir = 'writing/'; preserve kind
    case 'protocol':
      if tags include 'team/org': target_dir = 'org/'
      else: target_dir = 'concepts/'; preserve kind
    case 'timeline':
      split by primary entity → append to corresponding people/ or companies/ page
  write to target_dir/<slug>.md with full frontmatter preserved
```

## 反向：agent 创建页面时

`dikw-compile` skill 当 agent 决定创建页面时，先读 GBrain 的
`RESOLVER.md` 决定目录（MECE 首要原则），再根据页面特征设置 KOS `kind`
字段。这样 KOS 的质量管控维度不会跟 GBrain 的文件组织冲突。

## 需要手工判断的边缘情况

1. **系统架构文档**（如 `knowledge-os-architecture.md`）：技术上是 concept，
   但 org 和 project 都沾边。默认入 `concepts/`，如果属于内部项目文档
   可考虑 `projects/`。
2. **对话沉淀**（#ingest-to-wiki 出来的零散记录）：大概率 inbox → 经
   compile 后拆到对应类型。
3. **排障教训**（troubleshooting/incident）：KOS 没有专门类型，GBrain 也
   没有。建议：放 `concepts/` + `kind: troubleshooting` 或 `kind: protocol`。
