# 通用海岸数据包 v1 · 草稿

Web 与 Native 采用相同 envelope：format=elementera-coast-transfer、version=1、sha256、payload_json。SHA-256 校验原始 UTF-8 字符串；它不是签名或加密。来源标记不是认证；导入由目标模式决定存储。

此提交只实现云端聊天模块 API：GET /api/transfer/chat（可重复 conversation_id 参数），POST /api/transfer/chat/preview，POST /api/transfer/chat/import。后两者接收 bundle；写入需 confirm=true，有未选模块或不能转移字段还需 accept_omissions=true。现有登录与同源检查保持。预览不写入用户记录。新窗口保留轮次、变体、正文、活动索引、收藏/隐藏状态及可无损的模型来源和时间，目标窗口为确定性新 ID，原窗口 ID 记录为 source_window_id。重复导入不覆盖、不复活已删除窗口。全部写入一次 D1 batch。

限制：单包 64 MiB；云端请求 8 MiB、单窗口 1.5 MiB、1—40 个窗口，每窗 400 轮、每支 20 变体；超限拒绝，不截断。模型回波、工具摘要、附件/语音、其余模块及跨版本字段尚不完整迁移。云端导出当前只提供聊天模块，其余明确排除。现有 JSON/HTML/full archive 不变。UI、本机恢复事务、更多模块、跨语言固定向量与真机验证仍待施工；不发布半成品。
