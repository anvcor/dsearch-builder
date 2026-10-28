# DSEARCH 宏生成器

为 SYNOPSYS 光学设计软件的 **DSEARCH**（自动搜索初始结构）写 `.MAC` 宏的网页工具。在表单里填系统参数和搜索目标，页面实时生成宏文本，同时检查常见的写法错误。搜索完成后，还能生成一份**精修宏**，用来继续优化挑中的结果。

整个工具只有一个 `index.html` 文件，不用安装，也不用联网，浏览器打开就能用（联网时会加载 Google Fonts 字体）。

## 使用

1. 打开 `index.html`。可以直接双击，也可以开启 GitHub Pages（仓库 Settings → Pages → 选分支和根目录）后用网址访问。
2. 第一次用时，可以点"载入示例（35mm F/2.8）"，看一个完整的例子。
3. 从上到下填表。输出区实时显示生成的宏，以及"错误 / 注意 / 说明"三类检查结果。
4. 点"复制"或"下载"，把 `.MAC` 放进 SYNOPSYS 的工作目录（一般是 `USER` 文件夹），在命令窗口输入 `EM 文件名` 运行。
5. 挑好结果后，在输出区切到"精修宏"，生成并运行 `*_OPT.MAC`。

表单内容只保存在当前浏览器本地（`localStorage`），不会上传到任何地方。

## 功能

**DSEARCH 宏**
- **系统**：由焦距、半像高和 F 数换算 OBB，也可以直接填 OBB；设置波长和波长权重。
- **结构与搜索空间**：元件数、正负号组合（SINGLE / FILTER），逐面指定非球面（`ASPH n 面号…`、`ASPH Q`、`ASPH R`）。
- **起始结构**：RSTART、THSTART、ASTART、NSTART、PDIST、RANDOM、CSD、AFOCAL、IMMERSE、COVER、PLASTIC，以及正、负元件的指定玻璃（GLASS POS/NEG）。
- **渐晕**：编辑 VFIELD 表（可折叠，默认关闭）。可以用曲线生成，也可以从精修结果的 FVF 输出或 `.RLE` 里的 VFIELD 段导入。
- **目标**：FNUM、BACK、TOTL、光阑位置（FIRST / MIDDLE / LAST / FIX / TELE、FREE / REAL）、视场和视场权重、颜色、退火（ANNEAL）、QUICK 初筛方式、去敏（DSENS）、像质评价方式（OPD / SHEAR 等）。
- **附加控制**，写进 SPECIAL AANT：
  - 钉住像高（GIHT）。
  - **畸变百分比**：给上限或目标值，可以逐视场控制。
  - **像面主光线角 CRA 上限**。
  - 边厚、中心厚控制（AFE / AAE / ACC / ACM）。
- **模型玻璃边界**：CUL、FUL、CLL、FLL、CBOUNDS、FBOUNDS，默认写进 SPECIAL PANT，搜索结束后恢复程序默认值。
- **导入**：粘贴已有的 DSEARCH 宏，自动回填表单。本工具自己写的畸变、CRA、像高控制行会还原成对应的控件设置。

**精修宏（OPT.MAC）**
- 从镜库（GET）或文件（FETCH）载入结果。
- 设置硬口径（CAO）和实光阑（APS）。
- 用 FVF 计算渐晕。
- 变量（半径或 CSUM/CDIFF、厚度、非球面、模型玻璃）、光线集、边厚控制。
- 多轮 `SYNOPSYS n` + FVF，可选 ARGLASS 换成实际玻璃。
- 最后 CAP、EVAL、SAVE。

## rle_edge_check.py

检查 DSEARCH 结果镜片边厚的小脚本，只用 Python 3 标准库。它对 `.RLE` 做子午面实际光线追迹（球面、二次曲面、DC1 高次项，玻璃按 d 线的 GLM nd），在三个位置给出每片镜片的最小边厚：
- 自动 AEC 光线处（全视场上、下边缘光线，已按 VFIELD 缩小）；
- 渐晕后所有视场的光束处；
- 满光瞳（不渐晕的软口径，也就是 PAD 画出的口径）处。

```bash
python rle_edge_check.py DSEARCH01.RLE DSEARCH02.RLE --detail
```

不带文件名时，检查当前目录下的 `DSEARCH01–10.RLE`。它是近似计算（只算子午面、单一波长），用来发现明显的问题，不能代替 SYNOPSYS 自己的分析。

## 适用版本与说明

- 按 SYNOPSYS V15 / V16 的行为编写。规则来自 SYNOPSYS 手册和实际运行测试，其他版本请自行核对。
- 以下功能**还没有在 SYNOPSYS 里完整实测**，使用前先核对生成结果：
  - 把 AFE 等边厚控制写进 DSEARCH 的 SPECIAL AANT（搜索阶段）。
  - 精修宏的完整流程。
  - 畸变百分比组合项（`… A P YA h / DIV GIHT / MUL CONST 100/h / S CONST 100`）。
- CRA 上限（`LUA tan(CRA) … A P HH h 0 0 0`）在一轮搜索中实测生效。
- 页面给出的提示和告警是经验规则，不保证覆盖所有情况。

## 许可证

GNU General Public License v3.0 或更高版本（GPL-3.0-or-later），全文见 [LICENSE](LICENSE)。可以自由使用、修改和再发布；再发布修改版时，必须同样以 GPL-3.0 开源，并附上源代码。本程序不提供任何担保。

## 声明

本项目与 SYNOPSYS 的开发商 Optical Systems Design 没有任何关系。SYNOPSYS 是其所有者的商标。仓库里不包含 SYNOPSYS 的程序、文档或数据文件。工具只生成宏文本，运行宏需要合法授权的 SYNOPSYS。
