---
name: diagram-generator-svg
description: 用于生成技术博客文章SVG图表的技能。符合无障碍标准，集成Material Icons，支持6种设计模式。
allowed-tools: Read, Write, Bash
---
# 图表生成技能

用于生成技术博客文章的SVG图表。符合无障碍标准，集成Material Icons，支持6种设计模式。

## 何时使用

请在以下情况使用此技能：

- 用户想要为技术博客文章创建图解时
- 用户请求“制作图表”、“生成示意图”等时
- 需要架构图、流程图、关系图、比较图时
- 为了提升SEO，希望在文章中插入图解时

## 支持的图表模式

### 1. 架构图

- **分层架构**：水平层的表现
- **微服务**：服务间通信的可视化
- **事件驱动**：事件流程的表现

### 2. 流程图

- **处理流程**：逐步处理
- **数据流**：数据的转换与移动
- **用户流程**：用户交互

### 3. 关系图

- **实体关系图**：数据模型
- **类图**：对象关系
- **序列图**：时间序列的相互作用

### 4. 比较图

- **Before/After**：改进前后的对比
- **选项比较**：多个选项的并列显示
- **性能比较**：指标的可视化

### 5. 组件图

- **系统构成**：组件间的依赖关系
- **部署图**：物理配置

### 6. 概念图

- **概念地图**：概念间的关系
- **树状结构**：层次化信息

## 设计规范

### 尺寸与格式

- **推荐尺寸**：1280 x 720 px (16:9)
- **viewBox**：`0 0 1280 720`
- **格式**：SVG 1.1
- **保存路径**：`svg/`

**保存路径示例**：

- svg `/architecture-diagram.svg`
- svg `/flow-diagram.svg`

### 无障碍要求

- **对比度**：符合WCAG Level AA标准（4.5:1以上）
- **替代文本**：包含 `<title>` 和 `<desc>` 元素
- **避免仅依赖颜色**：颜色 + 形状 + 模式的组合
- **文本大小**：最小14px以上

### 设计指南

- **优先简洁**：不要塞入过多内容
- **适当的留白**：元素之间留有足够的空间
- **字符间距**：保持易于阅读的间距
- **渐变色**：谨慎使用
- **限制颜色数量**：避免过多的颜色信息（推荐3-5色）

### Material Icons 的使用

- **图标来源**：https://fonts.google.com/icons
- **格式**：嵌入SVG
- **尺寸**：24px、32px、48px（根据用途选择）
- **样式**：从Outlined、Filled、Rounded中选择

## 使用流程

### 1. 确认用户的请求

请确认用户是否提供了以下信息：

- 图表的类型（架构、流程、关系、比较等）
- 应包含的元素（组件、步骤、关系等）
- 特殊事项（颜色偏好、应强调的部分等）

### 2. 确认缺失信息

根据需要，请询问以下内容：

- 图表的标题
- 主要元素及其关系
- 应强调的要点
- 颜色偏好（如果有）

### 3. 生成SVG

请生成满足以下要求的SVG：

#### 基本结构

``````xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 1280 720"
     width="1280"
     height="720"
     role="img"
     aria-labelledby="diagram-title diagram-desc">

  <title id="diagram-title">[图表标题]</title>
  <desc id="diagram-desc">[图表说明]</desc>

  <defs>
    <!-- 定义可重用的元素 -->
  </defs>

  <!-- 图表内容 -->

</svg>
``````

#### 推荐调色板

考虑无障碍性的配色示例：

```
主色：    #2196F3 (蓝色)
辅色：    #4CAF50 (绿色)
强调色：  #FF9800 (橙色)
文本色：  #212121 (深灰色)
背景色：  #FFFFFF (白色)
边框色：  #BDBDBD (灰色)
```

### 4. 确认保存路径

请向用户确认文章的目录：

```
这是用于哪篇文章的图表？
例如：tmp-driven-development、uv-workspace 等
```

### 5. 保存文件

请保存到已确认的文章目录下的 svg/ 文件夹中：

```
svg/[描述性文件名].svg
```

**保存路径示例**:

- `svg/architecture-diagram.svg`
- svg `/workflow-flow.svg`
- `svg/before-after-comparison.svg`

**文件命名规则**:

- 使用小写字母和连字符
- 名称应能反映图表内容
- 可以包含模式名称（例如：`flow-user-auth.svg`, `arch-layered.svg`)

### 6. 向用户报告

请向用户报告以下信息：

- 生成的图表类型
- 保存路径
- 包含的主要元素
- 无障碍支持情况
- 下一步操作（建议转换为PNG格式）

## Response to User

### 成功时

```
✅ 已生成SVG图表。

【图表信息】
- 类型：[模式名称]
- 标题：[标题]
- 尺寸：1280 x 720 px (16:9)
- 保存路径：svg/[文件名].svg

【无障碍性】
- 对比度：符合WCAG Level AA标准
- 替代文本：已包含
- Material Icons：使用了[数量]个

【下一步操作】
如需转换为PNG格式，可以使用svg-to-png Skill，或执行以下命令：
```bash
uv run --package sios-tech-lab-analytics-ga4-tools svg2png svg/[文件名].svg
```

```

### 需要确认时

```

📝 请允许我确认图表的详细信息。

您能提供以下信息吗？

- [问题1]
- [问题2]
- [问题3]

```

## Important Notes

1. **viewBox设置**：务必设置 `viewBox="0 0 1280 720"`
2. **无障碍性**：`<title>` 和 `<desc>` 是必需的
3. **Material Icons**：请作为SVG路径嵌入（避免字体引用）
4. **对比度**：保持文本与背景的对比度在4.5:1以上
5. **简洁性**：不要塞入过多信息，确保适当的留白
6. **可重用性**：使用 `<defs>` 定义可重用的元素

## Design Pattern Examples

### 架构图示例

``````xml
<!-- レイヤードアーキテクチャ -->
<!-- 分层架构 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
  <title>分层架构</title>
  <desc>三层架构的构成图</desc>

  <!-- 表示层 -->
  <rect x="200" y="100" width="880" height="120"
        fill="#E3F2FD" stroke="#2196F3" stroke-width="2"/>
  <text x="640" y="170" text-anchor="middle"
        font-size="24" fill="#212121">表示层</text>

  <!-- 业务逻辑层 -->
  <rect x="200" y="260" width="880" height="120"
        fill="#E8F5E9" stroke="#4CAF50" stroke-width="2"/>
  <text x="640" y="330" text-anchor="middle"
        font-size="24" fill="#212121">业务逻辑层</text>

  <!-- 数据访问层 -->
  <rect x="200" y="420" width="880" height="120"
        fill="#FFF3E0" stroke="#FF9800" stroke-width="2"/>
  <text x="640" y="490" text-anchor="middle"
        font-size="24" fill="#212121">数据访问层</text>

  <!-- 箭头 -->
  <path d="M 640 220 L 640 260"
        stroke="#212121" stroke-width="2"
        marker-end="url(#arrowhead)"/>
  <path d="M 640 380 L 640 420"
        stroke="#212121" stroke-width="2"
        marker-end="url(#arrowhead)"/>

  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10"
            refX="5" refY="5" orient="auto">
      <polygon points="0 0, 10 5, 0 10" fill="#212121"/>
    </marker>
  </defs>
</svg>
```

### 流程图示例

``````xml
<!-- 简单的处理流程 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
  <title>用户认证流程</title>
  <desc>从登录到会话建立的流程</desc>

  <!-- 开始 -->
  <ellipse cx="200" cy="100" rx="80" ry="40"
           fill="#4CAF50" stroke="#2E7D32" stroke-width="2"/>
  <text x="200" y="110" text-anchor="middle"
        font-size="18" fill="#FFFFFF">开始</text>

  <!-- 处理1 -->
  <rect x="120" y="180" width="160" height="60" rx="5"
        fill="#2196F3" stroke="#1976D2" stroke-width="2"/>
  <text x="200" y="215" text-anchor="middle"
        font-size="16" fill="#FFFFFF">输入认证信息</text>

  <!-- 处理2 -->
  <rect x="120" y="280" width="160" height="60" rx="5"
        fill="#2196F3" stroke="#1976D2" stroke-width="2"/>
  <text x="200" y="315" text-anchor="middle"
        font-size="16" fill="#FFFFFF">验证处理</text>

  <!-- 结束 -->
  <ellipse cx="200" cy="400" rx="80" ry="40"
           fill="#F44336" stroke="#C62828" stroke-width="2"/>
  <text x="200" y="410" text-anchor="middle"
        font-size="18" fill="#FFFFFF">完成</text>

  <!-- 箭头 -->
  <path d="M 200 140 L 200 180" stroke="#212121" stroke-width="2"
        marker-end="url(#arrowhead)"/>
  <path d="M 200 240 L 200 280" stroke="#212121" stroke-width="2"
        marker-end="url(#arrowhead)"/>
  <path d="M 200 340 L 200 360" stroke="#212121" stroke-width="2"
        marker-end="url(#arrowhead)"/>

  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10"
            refX="5" refY="5" orient="auto">
      <polygon points="0 0, 10 5, 0 10" fill="#212121"/>
    </marker>
  </defs>
</svg>
``````

## Material Icons Integration

使用Material Icons时，请将其作为SVG路径嵌入。

### 图标获取方法

1. 访问 https://fonts.google.com/icons
2. 选择要使用的图标
3. 从"SVG"选项卡复制 `<path>` 元素
4. 嵌入到图表的SVG中

### 嵌入示例

``````xml
<!-- Database 图标示例 -->
<g transform="translate(100, 100)">
  <path d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z"
        fill="#2196F3"/>
</g>
``````

## Related Skills

- **svg-to-png**: 将生成的SVG转换为PNG格式
- **diagram-generator-html**: 使用HTML生成图表（使用Tailwind CSS）
- **html-to-png**: HTML→PNG转换Skill

## Related Documentation

详细设计信息请参考：

- Material Icons: https://fonts.google.com/icons
- WCAG Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
