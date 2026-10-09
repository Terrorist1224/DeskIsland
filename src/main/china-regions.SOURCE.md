# 中国大陆天气地点菜单数据

来源：[AreaCity-JsSpider-StatsGov](https://github.com/xiangyuecn/AreaCity-JsSpider-StatsGov)，发布版本 [2025.251231.260403](https://github.com/xiangyuecn/AreaCity-JsSpider-StatsGov/releases/tag/2025.251231.260403)，更新时间 2026-04-03。

从 `ok_data_level4.csv` 提取 `[id, pid, deep, ext_name]`，只保留中国大陆 31 个省级地区及其下属市、区县，排除上游福建分支中的金门县及所有第四级数据。重庆的“重庆城区”“重庆郊县”分组统一到重庆市节点，避免非行政区划名称导致坐标解析失败。所有地区都只选择到区县，不提供乡镇、街道、村或社区。

原始 `ok_data_level4.csv` SHA-256：`2bdaeef67fd6e4ade5aa8fba6b5fd2e72f140bb5691da7c42b67d32fe35e1001`。

数据使用上游 MIT 许可，见 `china-regions.LICENSE.txt`。行政区划快照可能缺少此版本之后的调整，上游注明未包含新疆新设和康县、和安县。省直辖县级市和东莞等地区保留上游的补齐层级；界面自动跳过唯一且同名的层级。旧四级设置不自动改写文件或坐标，界面和天气标签只显示前三层；用户重新保存后采用所选区县的新坐标。

此文件只提供名称与层级，不提供坐标。保存时通过 Nominatim 解析并校验完整行政路径；无匹配坐标时保留原设置，不替换为其他地区。
