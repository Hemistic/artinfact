# 工作布局配置

输入给 `save --input` 或 `plan --input` 的文件只包含一个预设：

```json
{
  "name": "开发",
  "panels": [
    {
      "placement": "right",
      "target": { "type": "file", "path": "README.md" }
    },
    {
      "placement": "bottom",
      "target": { "type": "browser", "url": "http://localhost:5173" }
    }
  ]
}
```

示例 URL 只是字段示例。真实使用时取用户 URL 或已知项目预览地址。

保存后的 `.codex/work-layouts.json` 格式：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "开发": {
      "name": "开发",
      "panels": [
        { "placement": "right", "target": { "type": "file", "path": "README.md" } }
      ]
    }
  }
}
```

- `name`：1–80 个字符，支持中文与空格。
- `panels`：1–20 项，按顺序打开；完全相同的目标和位置只生成一次调用。
- `placement`：`right` / `bottom`。
- 文件：`type: file`、`path`、可选正整数 `line`。计划生成前检查文件存在，输出绝对路径。
- 浏览器：`type: browser`、`url`。支持 HTTP/HTTPS（含 localhost），不接受内嵌账号密码。
- 终端：仅 `type: terminal`，不持久化 sessionId，不存执行命令。
- 审查：`type: review`、`view`（`last-turn` / `branch` / `unstaged` / `staged`）、可选项目相对 `path`。

不能设置 width、height、ratio、聊天位置或关闭其他标签。面板工具实际支持范围以当前宿主为准。
