# 🌌 ASCILINE Engine

**ASCILINE** is a high-performance, cross-platform real-time ASCII video rendering engine. **Our core objective is to transform the web into a highly dynamic and interactive typographic canvas.** By moving away from traditional video players, ASCILINE streams visual data from a Python backend directly into the browser at **60 FPS** as raw, manipulable text.

| Output | Details |
| :--- | :--- |
| <img src="https://github.com/user-attachments/assets/cc38d219-b4d2-4873-82dc-2abb179b5665" width="400" alt="Original Animation" /> | **Original Source**<br>Standard MP4 video file. |
| <img src="https://github.com/user-attachments/assets/6bd7f5c0-81de-49fe-ba0d-9a8872ec8ae3" width="400" alt="ASCII Mode" /> | **ASCII Mode**<br>Showcases rendered using Mode 3 (32K Colors) from a 30 FPS source video. The engine naturally synchronizes up to 60+ FPS depending on the source material. |
| <img src="https://github.com/user-attachments/assets/0d6e9d4c-662c-4e38-b451-70d9b142bc1d" width="400" alt="Pixel Mode" /> | **PIXEL Mode**<br>Showcases rendered using Mode 3 (32K Colors) combined with `--pixel`. Replaces characters with colored blocks for ultra-high performance. **At higher grid resolutions, The visual quality approaches standard 360p video streaming.** |

## 🎯 Strategic Vision & Core Capabilities

1. **Pure Typographic Manipulation**: The visual stream is not a standard media file—it's raw HTML/Canvas text. This makes the impossible possible: you can apply real-time CSS filters (neon glows, text shadows) to a playing video, dynamically manipulate colors, or let users literally copy a moving visual element with their cursor.
2. **Local AI & LLM Ready**: By reducing complex pixel streams into structured logical strings, ASCILINE acts as a perfect bridge for AI. Instead of feeding heavy computer vision models, lightweight text blocks can be fed directly to Local LLMs. Analyzing visual changes becomes as simple as taking a "diff" between two text strings.
3. **Ultra-Low Bandwidth & IoT Compatibility**: Standard codecs (H.264/VP9) choke microcontrollers and weak networks. ASCILINE processes the heavy lifting once on the backend, streaming only a few kilobytes of String packets per second via WebSockets. It enables zero-latency live streams on satellite connections, embedded systems, and extreme low-bandwidth environments.
4. **Bypassing Browser Constraints**: Modern browsers aggressively throttle autoplay videos, and ad-blockers restrict traditional media frames. To the browser, ASCILINE is simply "JavaScript updating text on a page." This circumvents traditional restrictions, allowing for immediate, unblockable visual streams.

## 🚀 Technical Features

-   **Cross-Platform**: Runs seamlessly on Windows, macOS, and Linux.
-   **Real-Time ASCII Streaming**: Low-latency video-to-ASCII conversion.
-   **Real-Time Pixel Streaming**: Replaces characters with colored blocks, approaching 360p video quality.
-   **High Performance**: Uses **HTML5 Canvas** for rendering, optimized for cinematic 24-30 FPS playback. High-FPS sources are automatically decimated for stability.
-   **Master Clock Sync**: The audio track acts as the absolute master clock, guaranteeing perfect A/V synchronization.
-   **Zero-Copy Binary Protocol**: Frames are streamed as raw binary (`Uint8Array`) directly to the canvas, saving bandwidth and CPU.
-   **Multiple Color Modes**: Supports everything from classic B&W to 16M color ultra-fidelity.
-   **Flexible Video Management**: Supports JSON playlists (per-video mode & volume), 
      folder-based auto-queuing (filesystem order), single-file mode, and infinite loop 
      playback — all controlled via CLI arguments.

## 🛠️ Architecture

1.  **Backend (Python/FastAPI)**: Decodes video using OpenCV, maps pixels to ASCII characters via NumPy, and streams binary data.
2.  **Frontend (Vanilla JS)**: Receives binary frames via WebSockets, manages a jitter buffer, and renders to a Canvas grid.
3.  **Communication**: Optimized WebSocket protocol with a custom `INIT` handshake for dynamic resolution/FPS adjustment.

## 📦 Installation

### 1. Clone the repository
```bash
git clone https://github.com/YusufB5/ASCILINE.git
cd ASCILINE
```

### 2. Install dependencies
```bash
pip install fastapi uvicorn opencv-python numpy websockets
```
### 🔈 Audio Support (FFmpeg Required)
To enable server-side audio processing (Volume 1-5), you must have FFmpeg installed.

**Option 1: Package Manager (Recommended)**
- **Windows:** `winget install ffmpeg`
- **macOS:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg`

**Option 2: Manual Installation (Windows)**
If you get a `FileNotFoundError` or don't want to modify system variables:
1. Download [FFmpeg ZIP](https://github.com/BtbN/FFmpeg-Builds/releases/latest).
2. Extract `ffmpeg.exe` from the `bin` folder.
3. Drop it directly into your `ASCILINE` project folder alongside `stream_server.py`.
### 3. Run the Web Server

**Single video:**
```bash
python stream_server.py video.mp4 --cols 240
```

**Folder mode — drop your videos into `videos/` and run:**
```bash
python stream_server.py --folder videos --cols 200
python stream_server.py --folder videos --cols 230 --loop          # infinite loop
python stream_server.py --folder videos --mode 5 --pixel --cols 320 --vol 2  # all videos same settings
```
Videos play in **filesystem order** (top to bottom as they appear in the folder, not alphabetically). Just add/remove files from the `videos/` folder to control the queue.

**JSON Playlist — full control per video:**
```bash
python stream_server.py --playlist playlist.json --cols 220
python stream_server.py --playlist playlist.json --cols 220 --loop
```
Use `playlist.json` when you need different `--mode` or `--vol` settings for each video.

> 💡 **Windows Users:** You can use the included `serve.bat` shortcut for quicker typing: `.\serve video.mp4 --cols 240`

Open `http://localhost:8000` in your browser.

### 4. Run directly in Terminal (Standalone)
If you prefer to bypass the web interface, you can render the video directly inside an ANSI-supported terminal (zero-flicker, true color):
```bash
python ascii_video_player2.py video.mp4 --cols 100 --quality 0
```
> 💡 **Windows Users:** Use the shortcut `.\play video.mp4 -c 100 -q 0`
> 
> ⚠️ **Note:** Do not resize your terminal window during playback, as dynamic text wrapping will corrupt the ASCII layout.

## 🎨 Customization

You can easily customize the look and feel of the engine:

### Styling
Edit `style.css` to change the accent colors and typography using CSS variables:
```css
:root {
    --accent-color: #00ff41; /* Classic Matrix Green */
    --bg-color: #050505;
}
```

### Rendering Modes
The engine supports different fidelity levels via the `--mode` flag:
- `1`: Black & White (DOM mode)
- `2`: 512 Colors
- `3`: 32K Colors
- `4`: 262K Colors
- `5`: 16M Colors (Ultra)

```bash
python stream_server.py --mode 5 --cols 240 --rows 100
```
### 📐 Resolution & Auto-Scaling
By default, you only need to specify the width (`--cols`). ASCILINE will automatically calculate the correct `--rows` based on the source video's aspect ratio to prevent stretching.

- **ASCII Mode Recommended:** `--cols 200` to `--cols 240` (Best balance of text detail and 30-40 FPS performance).
- **Pixel Mode Recommended:** `--cols 320` to `--cols 400` (Extremely fast, easily hits 60+ FPS,close to 360p video stream).
```bash
python stream_server.py video.mp4 --mode 5 --cols 240
# Terminal will show: [AUTO] 1920x1080 → grid 240x67
```
### Server-Side Volume Control
Volume is controlled at the server level via the `--vol` flag (scale 0–5).
When set to `0`, the audio engine (FFmpeg) **never runs**, saving CPU and bandwidth.

| `--vol` | FFmpeg Multiplier | Description |
|---------|------------------|-------------|
| `0`     | —                | Muted (no processing) |
| `1`     | 1.0×             | Normal (default) |
| `3`     | 1.5×             | Loud |
| `5`     | 2.0×             | Double volume |

```bash
python stream_server.py video.mp4 --pixel --cols 330 --vol 0   # Silent
python stream_server.py video.mp4 --cols 220 --vol 3   # Loud
```

### Playlist Format (`playlist.json`)
Each entry can override the global `--mode` and `--vol` defaults:
```json
[
    { "video": "intro.mp4",  "mode": 1, "vol": 1 },
    { "video": "main.mp4",   "mode": 5, "vol": 3 },
    { "video": "outro.mp4",  "mode": 3, "vol": 2 }
]
```
Video paths are resolved automatically — the engine checks the project root and the `videos/` subfolder, so you can write just the filename.

## 📜 License & Ethical Guardrails

**MIT License (with Anti-Ad Restriction)**

ASCILINE is distributed under the MIT License, but with a strict ethical guardrail.
Because this engine bypasses standard browser constraints and ad-blockers (by rendering pure text instead of video), we strictly prohibit its use by ad-networks to serve unblockable advertisements. 

See the [LICENSE](LICENSE) file for the full text, which includes the **ANTI-ADVERTISEMENT RESTRICTION** clause.
