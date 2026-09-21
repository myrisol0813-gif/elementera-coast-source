# Future vision images / 未来识图设计

Status: TODO after the APK baseline is stable.

Moment 与 Diary 正文不再保存图片 URL、`image_refs` 或类似“图片引用”字段。

未来如果海岸加入正文图片，应走真正的附件 / 文件对象：

1. 用户选择或上传图片，得到受控附件或文件对象。
2. 图片对象进入对话/内容自己的附件关系，而不是被压成 URL 字符串塞进 Moment/Diary 正文 schema。
3. 需要模型理解图片时，由后端把附件转入模型支持的 vision/image input 链路，并保留来源、权限和生命周期。
4. UI 展示使用受控附件对象，不把任意外部 URL 当成“模型看过图片”的证据。

the human-owner avatar field, model-partner avatar field, and moment-cover field 是页面装饰/profile 持久化，和未来正文识图链分开保留。

本轮只拆掉旧 URL/reference 路径，不实现新的识图系统。
