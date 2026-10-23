# 开发与维护

## 项目说明

本项目独立于其他桌宠：项目名称和 productName 为 `kaito-kid-pet`，appId 为 `com.kaitokid.pet`，初始版本 `1.0.0`。使用 Electron 44、Vue 3、TypeScript 和 Vite；本机开发端口固定 `127.0.0.1:5174`。

保持独立的 `node_modules`、素材、图标和用户数据，不通过符号链接依赖其他项目。`npm ci` 安装依赖；Electron 的首次运行可能需要下载对应平台运行时。

## 交互

- 待机只显示第 1 帧扑克牌，画布不常驻刷新；按压及播放时才请求 animation frame。
- 提示语为“双击原声变身”，鼠标为点击手形。移入移出不切换帧。
- 双击从第 1 帧播放到第 241 帧，按 24 FPS 原始时长约 10.0417 秒，原声播放一次；结束后复位音频及第 1 帧。
- 播放期间的再次双击不重启或叠加声音。开启分身模式后仍可创建新分身，新分身独立播放一次原声变身。
- 拖动阈值为 4 个屏幕 DIP，参与双击的任一次操作是拖动都不触发变身。
- 原生菜单提供全体变身、双击分身、清空分身、音量、大小、置顶、显示/隐藏、重置位置与退出。
- 分身上限 10 个，加载中的窗口也计数。向上约半屏、横向约 1/3～2/3 屏宽，允许暂时飞出顶部，最终在工作区底部落稳；触地有递减弹跳和轻微压扁。
- 设置由主进程保存到当前应用用户数据下的 `kid-settings.json`。退出应用时关闭全部实例；清空分身不删除本体。

## 素材

```text
public/kid/
  metadata.json
  kid_1.webp ... kid_241.webp      1280×720，透明完整画布
  display-360/                    360×203
  display-640/                    640×360
  display-960/                    960×540
  kid_transform.mp3
```

保留原始 16:9 画布，避免在变身途中裁掉飞散的羽毛或导致角色位置跳动。界面只显示透明画布中的素材；窗口会按对应比例缩放。

素材提取脚本：

```sh
python scripts/extract_frames.py --video "path/to/video.mp4" --ffmpeg "path/to/ffmpeg.exe" --output "new-output-directory"
```

依赖 Pillow、NumPy 和 FFmpeg，仅用于维护，运行桌宠无需 Python。脚本专用于当前 1280×720、241 帧素材，输出目录必须不存在，防止覆盖现有帧；只读取主视频轨，忽略封面附图轨。完整来源副本保存在忽略的 `artifacts/source-video.mp4` 供本机维护，不随安装包发布。

`remove_green()` 使用绿色通道优势生成透明度，仅在半透明边缘处理绿溢色，不把白色区域变透明，也不删除独立白色羽毛。需要重新生成分档帧时运行：

```sh
python scripts/build_display_frames.py
```

## 实现与资源预算

- `electron/main.cjs`：透明窗口、托盘、多实例状态、受信任主 frame IPC、共享菜单、设置和全体变身。
- `electron/clone-motion.cjs`：按时间计算抛物线与递减弹跳，屏幕 DIP 坐标，每次移动固定 client bounds，避免分数 DPI 累积漂移。
- `src/App.vue`：双击/拖动区分、原生菜单、按压和设置同步。
- `src/components/PetSprite.vue`：静态待机、原声、滚动缓存、尺寸/DPI 监听和 Canvas 绘制。
- `src/lib/playback.ts`：241 帧时间轴、同步播放锁和异常复位。
- `src/lib/render-budget.ts`：按窗口尺寸/DPI 计算画布，最高 1280×720；选择满足需求的最小源图。
- `src/lib/press-effect.ts`：640×360 逻辑坐标、局部变形、阻尼回弹。

静态待机只保留第 1 帧。播放时最多保留首帧、当前帧及后续 7 帧（最多 9 张位图），最多 2 路解码。缩放或跨屏 DPI 变化时取消旧请求、关闭过期位图、重建缓存；声音和动画进度不重启。主画布/临时画布使用面向频繁读写的 2D 上下文策略，不全局关闭 GPU。图像本身的透明区域仍可能拦截鼠标，当前不提供按像素鼠标穿透。

## 测试与构建

```sh
npm test
python -m unittest discover -s scripts -p "test_*.py"
npm run build
npm run dist:win
npm run dist:mac
```

打包先在系统临时目录构建，成功后将安装包复制到 `release/` 并清理旧产物；失败不覆盖上一份安装包。macOS 打包需在 Mac 上执行；当前不包含发行证书和公证配置。

`.github/workflows/release.yml` 保留版本标签自动构建/发布流程：上传到新的 GitHub 仓库后，推送与 package 版本一致的标签，例如 `v1.0.0`，会构建 Windows 和 macOS 安装包。项目仓库为 [hedong433664/kaito-kid-pet](https://github.com/hedong433664/kaito-kid-pet)。仅推送 main 不自动发布安装包；需要发布时再推送与版本一致的标签。
