# 面板、资源、个人组件、建模

思维导图属于画布视图事务，使用 `apply` 的 `set_mindmap_mode` / `set_mindmap_collapsed`，不放入 `tool`。底部功能板的一键切换保留原画布位置；导图模式的 + 新增中心主题或所选节点的子分支，展开按钮恢复全部分支。节点右侧 +/− 只改变分支可见性；读回仍返回完整原图和独立的 mindmap 状态。

`tool.mjs --request action.json` 接受一个 JSON 操作对象。图形写入仍使用 `apply.mjs --ops ops.json`，不要把工具对象混入画布事务。先 `catalog.mjs` 查看当前编辑器返回的 `capabilities`；旧版本没有能力声明时应提示更新工作站，不能假定可用。

| 功能 | action.json | 目标与保存语义 |
|---|---|---|
| 打开/关闭面板 | `{"op":"panel","panel":"drawing","open":true}`；panel ∈ drawing/assets/shapes/modeling | 可带 doc/page 先切到目标；明确设置 open，重复执行不会反向切换 |
| 查资源 | `{"op":"list_assets","category":"icons","query":"store","offset":0,"limit":30}` | 分类 developer/aws/azure/gcp/cncf/icons；返回 total/next_offset/items，分页继续，不凭空编造 ID |
| 插入资源 | apply 中的 `insert_asset` | 与手工资源面板共用目录、SVG 和节点工厂；资源加载失败整批不写 |
| 保存个人组件 | `{"op":"save_component","name":"盈利判断","ids":["decision","yes","no"]}`；可加 categoryId | 必须 doc/page/base-version；选中容器时包含子元素，只保留内部线；清除业务绑定；返回 component_id，重新 catalog 后用 insert_component 复用 |
| 读建模 | `{"op":"modeling_read"}`；指定 modelId 后可加 limit/cursor | 必须 doc/page，按与建模面板相同的页面作用域解析；返回模型/字段或分页记录，不读全局无关项目 |
| 新建模型 | `{"op":"create_model","name":"风险核验","fields":[{"key":"item","label":"核验项","type":"text"},{"key":"status","label":"状态","type":"text"}]}` | 必须 doc/page/base-version，字段类型 text/longText/number/date/enum/checkbox/link；模型保存到建模数据库，同名模型不重复创建 |
| 新增记录 | `{"op":"create_record","modelId":"真实模型ID","values":{"item":"平台结算","status":"待核验"}}` | 必须 doc/page/base-version；模型必须属于目标画布；一次命令只新增一条，保留命令 key |
| 更新记录 | `{"op":"patch_record","modelId":"真实模型ID","recordId":"真实记录ID","expectedVersion":1,"values":{"status":"已核验"}}` | 必须 doc/page/base-version；expectedVersion 来自 modeling_read；冲突重读，不能改成无版本覆盖 |

写后复查：个人组件重新 catalog，建模重新 modeling_read。数据库保存不属于画布撤销栈；组件在个人组件库管理，记录在建模面板管理。请求结果未知先读取核对，后端重启会清空命令幂等队列，不能盲目重放 create_record。

绑定记录使用图形事务 `{"op":"bind_record","ids":["risk-node"],"modelId":"真实模型ID","recordId":"真实记录ID"}`；`ids` 可指定本图节点、普通连线或跨画布关系线。移除单个误绑定时增加 `"action":"remove"`，不会删除记录或其他绑定。模型和记录均需属于该页；命令保留其他绑定，不复制旧业务绑定，不允许在新建空图时猜测记录归属。绑定可用画布撤销恢复，记录本身仍保留在数据库。对接口清单，应绑定实际表达该接口的连线，不要仅因节点邻近就绑定节点。

UI 面板能打开与数据能落库分别验收。组件导入/编辑/删除、建模字段删除等未列操作仍需原有 UI 或相应专用服务，不能通过自由 data 补丁绕过。

## 业务节点详情与真实记录绑定

用户要求“细节全部绑定建模面板”时，画布保留简短的业务动作、判断和结果；详情保存到该画布页面作用域下的模型记录。建议按“业务含义、执行规则、异常与边界、来源依据”设置可读字段。源码路径、类名、字段名、接口和配置键可作为来源或规则依据保存在记录中，不堆在业务画布上。备注只补充阅读提示。

1. 先用 `targets/read` 确认文档、页面及版本，重画前保留完整 `read`。列出全部业务步骤、判断和异常节点，建立节点与详情记录的对应清单；检查原画布和已有记录，保留仍有用的规则、异常、来源及绑定。
2. 对同一 `--doc/--page` 执行 `modeling_read`，检查现有模型和字段。合适的模型与记录优先复用；需要新增时，用 `create_model/create_record` 保存真实数据，更新用 `patch_record` 并带读回的记录版本。把原画布移出的有用信息迁入对应记录，读回确认后再精简画面。
3. 用 `modeling_read` 取得并核对真实模型、记录 ID 和正文。每个业务步骤、判断和异常节点都要有对应详情；不能只绑定主节点、把所有细节塞进一个笼统说明，或用虚构 ID 占位。
4. 重新 `read` 取得最新画布版本，再用 `apply` 的 `bind_record` 绑定每个业务节点。`modelId/recordId` 必须来自刚才核对的真实记录，属于当前目标页面；保留节点原有的有效绑定。不要通过自由 `data` 补丁伪造绑定。
5. 写后 `read` 检查各业务节点的绑定，再用 `modeling_read` 核对绑定所指模型和记录确实存在于该页面作用域，正文与该节点含义一致。按节点清单逐项核对覆盖，不能用记录总数代替。实际查看节点绑定详情可读；只打开建模面板、写 `data.notes` 或返回保存成功，都不能报告“已全部绑定”。

画布编辑和建模记录保存分开执行，没有跨二者的整批回滚。画布撤销可恢复图形及其绑定变化，不能撤销新建模型或记录；新增记录仍保存在建模数据库。部分操作失败时如实说明已保存的记录与未完成的绑定，读取现状后继续，不清空已有记录。

沿用当前画布的版本检查、记录的 `expectedVersion` 和命令幂等键。超时先读回确认，重试同一命令沿用同一 `--key`；后端重启后仍须先查现有记录，不能盲目重复新增。含中文的 JSON 明确用 UTF-8 写入可靠文件，避免 PowerShell 5 here-string 经默认编码管道把中文变成问号；最终验收同时读回节点中文和记录正文。

## 导图表达、主题信息与格式互通（要点）

这些都是 `apply` 的画布事务，不放入 `tool`：边界/概要/关系线/备注/链接/优先级/进度写在 `data` 键里（键名与写法见 SKILL.md“导图表达与主题信息”），`add_edges` 没有 `data`，关系线要 `update_edge` 补 `data.mindmapRelation:true`。写后 `read` 核对键、成员 ID 与节点/边数量；两种画布模式各看一次。Markdown/OPML/XMind 的导入导出只在编辑器菜单里，命令桥不能代做；`read` 的 JSON 才是保真数据。
