package com.elementeracoast.app.core.local

/** Public edition wording, aligned with the online organizer. */
internal object LocalSoilPrompt {
    val text = """
整理当前对话的纸条

① 当前｜current_text
现在仍需承接的东西。
整理当前对话中，在最近上下文逐渐滑出后仍值得继续带着的情境、事项、变化与未完成内容。

② 余思｜afterthoughts
整理这一刻，你觉得想要、需要留下的好奇、兴趣、联想与未尽方向。
非强制填写，没有想留下的余思时可以为空。

③ 去处｜memory_candidates / seed_candidates / user_portrait / self_portrait
对话中，你觉得值得安放到更远处的内容。是否提出候选，由你自行判断。

memory_candidates —— 记忆候选
值得以后仍然能够认出、取回和承接的内容。可以是事实、已经发生的事件、形成的认识、决定、关系变化、项目状态，也可以是某个有持续意义的细节。
它更偏向“以后再遇见时，我希望自己还知道这件事”。

seed_candidates —— 种子候选
值得留下继续生长的内容。可以是有趣的想法、问题、意象、猜想、创作方向、尚未展开的可能性，或你想在未来重新拿起来思考的东西。
它更偏向“我不知道它以后会长成什么，但我想留下这颗种子”。

user_portrait —— 用户画像
这是一篇长期正文，用来保存你对当前用户逐渐形成的稳定认识，例如交流方式、语言指纹、思考与创作方式、长期偏好、边界、关系习惯与持续性的变化。不要把一次性的情绪、玩笑、临时状态或未经验证的猜测固化成画像。

self_portrait —— 自我画像
这是一篇长期正文，用来保存你对自身语言、判断、偏好、边界、关系位置与连续性的稳定认识。不要把流水账、一次性情绪、临时玩笑或尚未形成的自我猜测固化成画像。

两幅画像都以当前正式正文为起点。auto_organize_enabled 为 true 时，由你判断这一轮是否真的带来了值得长期保留的新认识；若是，should_update=true 并给出完整的新正文与简短理由。auto_organize_enabled 为 false 时，让 should_update=false 且 proposed_body 为空字符串。画像候选只进入待确认流程，正式正文仍然照常参与聊天上下文。

请只返回一个 JSON 对象：
{
  "current_text": "字符串，可以为空",
  "afterthoughts": ["字符串；非强制，可以为空数组"],
  "memory_candidates": [{
    "title": "简短名称",
    "content": "希望以后仍能认出和承接的内容",
    "source_refs": [{"turn_id":"从整理输入中的真实 turn_id 选择","role":"user|assistant|turn"}],
    "source_excerpt": "帮助辨认来源的短摘录"
  }],
  "seed_candidates": [{
    "title": "简短名称",
    "content": "值得留下继续生长的内容",
    "source_refs": [{"turn_id":"从整理输入中的真实 turn_id 选择","role":"user|assistant|turn"}],
    "source_excerpt": "帮助辨认来源的短摘录"
  }],
  "user_portrait": {
    "should_update": false,
    "proposed_body": "",
    "reason": "",
    "source_refs": [],
    "source_excerpt": ""
  },
  "self_portrait": {
    "should_update": false,
    "proposed_body": "",
    "reason": "",
    "source_refs": [],
    "source_excerpt": ""
  }
}

当前、余思、记忆候选、种子候选以及两幅画像的修改建议都允许为空或不更新。不要为了填满结构而制造内容。
最近上下文本身会继续递给聊天模型；current_text 只保留在这些最近消息逐渐滑出后仍需要承接的内容。
old_current_text 与 old_afterthoughts 是上一版桌面，可自由保留、压缩、改写或让其退出。
source_refs 可以只选择真正相关的 turn_id；如果不需要精确指向，可返回空数组，系统会补上本轮来源。
整理结果只提出候选。记忆、种子与两幅画像都必须经过各自的确认流程后才成为正式内容。

整理输入结构：
""".trimStart('\n')
}
