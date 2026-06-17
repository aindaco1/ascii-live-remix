"""
stream_server.py
================
Streams the core Video-to-ASCII engine to the web via HTTP/WebSocket.
Dependencies: pip install fastapi uvicorn websockets

Priority Order:
  1. --playlist playlist.json  → JSON file (per-video vol, mode, path)
  2. --folder ./videos         → folder scan (filesystem order, not alphabetical)
  3. positional video arg      → single video (legacy behavior)
"""

import asyncio
import contextlib
import subprocess
import json
import numpy as np
import cv2
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
from urllib.parse import urlparse
from websockets.exceptions import ConnectionClosed

# Import the existing engine (ascii_video_player2.py)
from ascii_video_player2 import VideoDecoder, AsciiMapper
from codec import encode_frame

app = FastAPI()


def get_video_dimensions(path: str) -> tuple[int, int]:
    """Quickly probe a video file to get (width, height) without decoding frames."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Could not open video file: {path!r}")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return w, h


def calc_auto_rows(cols: int, vid_w: int, vid_h: int, pixel_mode: bool) -> int:
    """
    Calculate rows from video aspect ratio.
    ASCII mode: characters are ~2x taller than wide, so divide by 2.
    Pixel mode: cells are square (CSS stretches), no correction needed.
    """
    ratio = vid_w / max(vid_h, 1)
    if pixel_mode:
        return max(1, round(cols / ratio))
    else:
        return max(1, round(cols / ratio / 2))

# Serve only whitelisted static files (security: prevents directory traversal)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_WHITELIST = {"app.js", "style.css", "codec.js"}

app.mount(
    "/renderers",
    StaticFiles(directory=os.path.join(BASE_DIR, "renderers")),
    name="renderers",
)
app.mount(
    "/media",
    StaticFiles(directory=os.path.join(BASE_DIR, "media")),
    name="media",
)

@app.get("/static/{filename}")
async def serve_static(filename: str):
    if filename not in STATIC_WHITELIST:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    filepath = os.path.join(BASE_DIR, filename)
    return FileResponse(filepath, headers={"Cache-Control": "no-store, max-age=0"})

async def _serve_root_static_file(filename: str):
    if filename not in STATIC_WHITELIST:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    filepath = os.path.join(BASE_DIR, filename)
    return FileResponse(filepath, headers={"Cache-Control": "no-store, max-age=0"})

@app.get("/app.js")
async def serve_root_app_js():
    return await _serve_root_static_file("app.js")

@app.get("/style.css")
async def serve_root_style_css():
    return await _serve_root_static_file("style.css")

@app.get("/codec.js")
async def serve_root_codec_js():
    return await _serve_root_static_file("codec.js")

def get_html_content():
    html_path = os.path.join(os.path.dirname(__file__), "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        return f.read()

def resolve_video_path(video: str) -> str:
    """
    Resolves a video path by checking multiple locations in order:
      1. As-is (absolute or relative to CWD)
      2. Inside the project root (BASE_DIR)
      3. Inside BASE_DIR/videos/ subfolder
    Returns the first path that exists, or the original string if none found.
    """
    candidates = [
        video,
        os.path.join(BASE_DIR, video),
        os.path.join(BASE_DIR, "videos", os.path.basename(video)),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return video  # Return original; error will be caught during playback

def load_playlist(playlist_path: str) -> list[dict]:
    """Loads playlist from a JSON file and resolves all video paths."""
    with open(playlist_path, "r", encoding="utf-8") as f:
        items = json.load(f)
    for item in items:
        item["video"] = resolve_video_path(item["video"])
    return items

def load_folder(folder_path: str, default_mode: int, default_vol: int) -> list[dict]:
    """
    Scans a folder for video files in filesystem order (top to bottom,
    as they appear in the directory — not alphabetically sorted).
    """
    supported = (".mp4", ".mkv", ".avi", ".mov", ".webm")
    entries = []
    with os.scandir(folder_path) as it:
        for entry in it:
            if entry.is_file() and entry.name.lower().endswith(supported):
                entries.append({
                    "video": entry.path,
                    "mode":  default_mode,
                    "vol":   default_vol
                })
    # Filesystem order (no sort applied)
    return entries

def build_queue(args) -> list[dict]:
    """
    Builds the video queue based on argument priority:
      1. --playlist JSON file
      2. --folder directory
      3. Single positional video argument
    """
    if args.playlist:
        print(f"[PLAYLIST] Loading: {args.playlist}")
        items = load_playlist(args.playlist)
        # Fill missing fields with global defaults
        for item in items:
            item.setdefault("mode", args.mode)
            item.setdefault("vol",  args.vol)
            item.setdefault("pixel", args.pixel)
            
            is_pixel = item.get("pixel", False)
            default_cols = args.cols if args.cols is not None else (450 if is_pixel else 200)
            item.setdefault("cols", default_cols)
            item.setdefault("rows", args.rows)
        return items

    if args.folder:
        print(f"[FOLDER] Scanning: {args.folder}")
        items = load_folder(args.folder, args.mode, args.vol)
        default_cols = args.cols if args.cols is not None else (450 if args.pixel else 200)
        for item in items:
            item["pixel"] = args.pixel
            item["cols"] = default_cols
            item["rows"] = args.rows
        return items

    # Legacy: single video argument
    default_cols = args.cols if args.cols is not None else (450 if args.pixel else 200)
    return [{"video": resolve_video_path(args.video), "mode": args.mode, "vol": args.vol, "pixel": args.pixel, "cols": default_cols, "rows": args.rows}]


# ── APP STATE ──────────────────────────────────────────────
# Queue is stored in app.state so the WebSocket endpoint can read it.
# current_index tracks which video is playing.
# loop flag controls infinite playback.
# ──────────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Serves the Frontend (HTML/JS/CSS) file to the client."""
    return HTMLResponse(get_html_content(), headers={"Cache-Control": "no-store, max-age=0"})


@app.get("/audio")
async def audio_stream(v: int | None = None):
    """
    Extracts and streams audio from the currently active video entry.
    Server-side volume control via the entry's 'vol' field (0-5 scale).
      0 = Muted (FFmpeg never runs)
      1 = Normal (1.0x)
      5 = Double  (2.0x)
    Per-session: ?v=<index> selects which queue entry to serve audio for.
    """
    queue = getattr(app.state, "queue", [])
    idx   = getattr(app.state, "current_index", 0)
    if v is not None and 0 <= v < len(queue):
        idx = v
    entry = queue[idx] if queue and 0 <= idx < len(queue) else {}

    vol_level  = entry.get("vol", 1)
    video_path = entry.get("video", "video.mp4")

    # vol 0 → skip audio entirely, no FFmpeg process
    if vol_level <= 0:
        from fastapi import Response
        return Response(status_code=204)

    if not os.path.exists(video_path):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Video file not found")

    # Map 1-5 → 1.0x-2.0x FFmpeg volume
    ffmpeg_vol = 1.0 + (vol_level - 1) * 0.25

    def audio_generator():
        process = subprocess.Popen(
            [
                "ffmpeg",
                "-nostdin",
                "-i", video_path,
                "-vn",
                "-filter:a", f"volume={ffmpeg_vol}",
                "-acodec", "libmp3lame",
                "-ab", "128k",
                "-ar", "44100",
                "-f", "mp3",
                "-loglevel", "quiet",
                "pipe:1"
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL
        )
        try:
            while True:
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                yield chunk
        finally:
            process.stdout.close()
            try:
                process.terminate()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    return StreamingResponse(
        audio_generator(),
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "bytes"}
    )


def _origin_allowed(origin: str | None, host_header: str | None = None) -> bool:
    """Reject cross-site WebSocket hijacking while allowing localhost and LAN same-origin."""
    if not origin:
        return True  # non-browser clients / test harness send no Origin
    try:
        origin_host = urlparse(origin).hostname
    except ValueError:
        return False
    if origin_host in {"localhost", "127.0.0.1"}:
        return True
    # Same-origin: the page was served by THIS server. Covers LAN mode
    # (--host 0.0.0.0), where the Origin host is the server's own LAN IP.
    if host_header and origin_host == host_header.split(":")[0]:
        return True
    return False

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Streams ASCII frames for every video in the queue.
    Advances to the next entry automatically when a video ends.
    Loops back to the start if --loop is set.
    """
    # ── Origin Check (prevents cross-site WebSocket hijacking) ──
    origin = websocket.headers.get("origin")
    if not _origin_allowed(origin, websocket.headers.get("host")):
        await websocket.close(code=1008)
        return

    await websocket.accept()

    # Opt-in adaptive codec (raw/zlib/delta). Legacy clients omit it and get
    # the original uncompressed binary protocol, byte-for-byte unchanged.
    adaptive = websocket.query_params.get("codec") == "adaptive"
    tolerance = getattr(app.state, "tolerance", 0)  # lossy colour drift budget

    queue = getattr(app.state, "queue", [])
    loop  = getattr(app.state, "loop", False)

    if not queue:
        await websocket.send_text("Error: No video in queue!")
        await websocket.close()
        return

    queue_index = 0  # local index; advances through the queue
    session_overrides: dict = {}
    session_state = {
        "tolerance": tolerance,
        "fps_cap": 30,
    }
    control_queue: asyncio.Queue[dict] = asyncio.Queue()

    async def control_reader():
        while True:
            try:
                text = await websocket.receive_text()
            except (WebSocketDisconnect, RuntimeError):
                break
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict) and msg.get("type") == "params":
                await control_queue.put(msg.get("params", {}))

    control_task = asyncio.create_task(control_reader())
    client_gone = False

    async def send_text_safe(payload: str) -> bool:
        nonlocal client_gone
        try:
            await websocket.send_text(payload)
            return True
        except (WebSocketDisconnect, ConnectionClosed, RuntimeError):
            client_gone = True
            return False

    async def send_bytes_safe(payload: bytes) -> bool:
        nonlocal client_gone
        try:
            await websocket.send_bytes(payload)
            return True
        except (WebSocketDisconnect, ConnectionClosed, RuntimeError):
            client_gone = True
            return False

    try:
        while not client_gone:
            entry      = {**queue[queue_index], **session_overrides}
            video_path = entry["video"]
            render_mode= entry["mode"]
            pixel_mode = entry.get("pixel", False)
            cols       = entry.get("cols", 200)
            rows_cfg   = entry.get("rows", 0)

            # IMPORTANT: Update current_index BEFORE sending INIT so that
            # when the client reloads /audio in response to INIT, the endpoint
            # already serves the correct video's audio.
            app.state.current_index = queue_index

            print(f"[PLAYING] ({queue_index + 1}/{len(queue)}) {video_path}  "
                  f"mode={render_mode}  pixel={pixel_mode}  vol={entry['vol']}")

            # ── Auto-calculate rows if not specified ──
            try:
                vid_w, vid_h = get_video_dimensions(video_path)
            except FileNotFoundError:
                if not await send_text_safe(f"Error: '{video_path}' not found!"):
                    break
                queue_index += 1
                if queue_index >= len(queue):
                    if loop:
                        queue_index = 0
                    else:
                        break
                continue

            if rows_cfg == 0:
                rows = calc_auto_rows(cols, vid_w, vid_h, pixel_mode)
                print(f"[AUTO] {vid_w}x{vid_h} → grid {cols}x{rows}")
            else:
                rows = rows_cfg

            try:
                decoder = VideoDecoder(video_path, cols, rows, skip_gray=pixel_mode)
            except FileNotFoundError:
                if not await send_text_safe(f"Error: '{video_path}' not found!"):
                    break
                queue_index += 1
                if queue_index >= len(queue):
                    if loop:
                        queue_index = 0
                    else:
                        break
                continue

            mapper       = AsciiMapper()
            source_fps   = decoder.fps
            MAX_FPS      = max(1, int(session_state.get("fps_cap", 30)))
            char_byte_lut= np.array([ord(c) for c in mapper._lut], dtype=np.uint8)
            qb           = {5: 0, 4: 2, 3: 3, 2: 5}.get(render_mode, 0)

            # ── FPS DECIMATION ──
            # If source > 30 FPS, skip every Nth frame using grab() (no decode).
            # This halves CPU load for 60 FPS sources.
            if source_fps > MAX_FPS:
                skip_n = round(source_fps / MAX_FPS)  # e.g. 60/30 = 2
                effective_fps = source_fps / skip_n
            else:
                skip_n = 1
                effective_fps = source_fps
            frame_t = 1.0 / effective_fps

            if not await send_text_safe(f"INIT:{effective_fps}:{render_mode}:{cols}:{rows}:{int(pixel_mode)}:{queue_index}"):
                break
            if skip_n > 1:
                print(f"[FPS CAP] {source_fps} FPS → {effective_fps} FPS (skip every {skip_n} frames)")

            frame_buf = np.empty((rows, cols, 4), dtype=np.uint8) if render_mode > 1 else None

            import struct
            import time
            start_time = asyncio.get_event_loop().time()
            bw_start_time = time.time()
            bw_bytes_sent = 0
            bw_raw_bytes = 0
            debug_mode = getattr(app.state, "debug", False)
            frame_index = 0
            prev_frame = None  # previous framebuffer snapshot for delta coding

            # Pre-allocate send buffer WITH header space to avoid per-frame concat
            if pixel_mode:
                # Zero-Copy Pixel: 4-byte header + raw BGR (3 bytes per pixel)
                pixel_send_buf = bytearray(4 + rows * cols * 3)
            elif render_mode > 1:
                # ASCII Color: 4-byte header + [char,R,G,B] per pixel
                ascii_send_buf = bytearray(4 + rows * cols * 4)

            reinit_requested = False
            try:
                while True:
                    while not control_queue.empty():
                        params = await control_queue.get()
                        if not isinstance(params, dict):
                            continue

                        if "codecQuality" in params:
                            q = params.get("codecQuality")
                            session_state["tolerance"] = {
                                "lossless": 0,
                                "high": 4,
                                "balanced": 8,
                                "low": 16,
                            }.get(q, session_state["tolerance"])
                        if "codecTolerance" in params:
                            try:
                                session_state["tolerance"] = max(0, int(params["codecTolerance"]))
                            except (TypeError, ValueError):
                                pass
                        if "fpsCap" in params:
                            try:
                                session_state["fps_cap"] = max(1, int(params["fpsCap"]))
                                reinit_requested = True
                            except (TypeError, ValueError):
                                pass

                        structural = False
                        for key in ("cols", "rows", "mode", "pixel"):
                            if key in params:
                                structural = True
                                if key in {"cols", "rows", "mode"}:
                                    try:
                                        session_overrides[key] = int(params[key])
                                    except (TypeError, ValueError):
                                        continue
                                elif key == "pixel":
                                    session_overrides[key] = bool(params[key])
                        if structural:
                            reinit_requested = True

                    if reinit_requested:
                        print("[REINIT] Applying live stream parameter changes.")
                        break

                    # ── FPS DECIMATION via grab() ──
                    # For 60→30 fps: grab (skip) 1 frame, then decode 1 frame.
                    # grab() is ~10x faster than read() because it skips decoding.
                    for _ in range(skip_n - 1):
                        if not decoder.grab():
                            break  # EOF reached during skip

                    try:
                        gray_frame, bgr_frame = next(decoder)
                    except StopIteration:
                        break

                    if pixel_mode:
                        # ── PIXEL MODE: raw BGR (3 bytes/cell) ──
                        raw_size = 4 + rows * cols * 3
                        if adaptive:
                            msg, prev_frame = encode_frame(
                                np.ascontiguousarray(bgr_frame),
                                prev_frame,
                                frame_index,
                                tolerance=session_state["tolerance"],
                            )
                            if not await send_bytes_safe(msg):
                                break
                            bw_bytes_sent += len(msg)
                            bw_raw_bytes += raw_size
                        else:
                            # ── ZERO-COPY PIXEL MODE (legacy) ──
                            struct.pack_into(">I", pixel_send_buf, 0, frame_index)
                            pixel_send_buf[4:] = bgr_frame.tobytes()
                            payload = bytes(pixel_send_buf)
                            if not await send_bytes_safe(payload):
                                break
                            bw_bytes_sent += len(payload)
                            bw_raw_bytes += len(payload)
                    else:
                        indices = np.floor_divide(gray_frame, max(1, 256 // mapper._n))
                        np.clip(indices, 0, mapper._n - 1, out=indices)

                        if render_mode == 1:
                            char_matrix = mapper._lut[indices]
                            lines = [''.join(row) for row in char_matrix]
                            payload = f"{frame_index}\n" + '\n'.join(lines)
                            if not await send_text_safe(payload):
                                break
                            payload_size = len(payload.encode("utf-8"))
                            bw_bytes_sent += payload_size
                            bw_raw_bytes += payload_size
                        else:
                            char_codes = char_byte_lut[indices]
                            rgb = bgr_frame[:, :, ::-1]
                            if qb > 0:
                                rgb = (rgb >> qb) << qb
                            frame_buf[:, :, 0] = char_codes
                            frame_buf[:, :, 1:] = rgb
                            raw_size = 4 + rows * cols * 4
                            if adaptive:
                                msg, prev_frame = encode_frame(
                                    frame_buf,
                                    prev_frame,
                                    frame_index,
                                    tolerance=session_state["tolerance"],
                                )
                                if not await send_bytes_safe(msg):
                                    break
                                bw_bytes_sent += len(msg)
                                bw_raw_bytes += raw_size
                            else:
                                struct.pack_into(">I", ascii_send_buf, 0, frame_index)
                                ascii_send_buf[4:] = frame_buf.tobytes()
                                payload = bytes(ascii_send_buf)
                                if not await send_bytes_safe(payload):
                                    break
                                bw_bytes_sent += len(payload)
                                bw_raw_bytes += len(payload)

                    if client_gone:
                        break

                    current_time = time.time()
                    if debug_mode and current_time - bw_start_time >= 1.0:
                        raw_kbps = bw_raw_bytes / 1024
                        wire_kbps = bw_bytes_sent / 1024
                        ratio = raw_kbps / wire_kbps if wire_kbps > 0 else 0
                        print(f"[BW] RAW: {raw_kbps:.1f} KB/s | WIRE: {wire_kbps:.1f} KB/s | {ratio:.1f}x compression")
                        bw_start_time = current_time
                        bw_bytes_sent = 0
                        bw_raw_bytes = 0

                    elapsed = asyncio.get_event_loop().time() - start_time
                    wait = (frame_index * frame_t) - elapsed
                    if wait > 0:
                        await asyncio.sleep(wait)
                    
                    frame_index += 1

            finally:
                decoder.release()

            if client_gone:
                break

            if reinit_requested:
                continue

            # Video finished → advance queue
            queue_index += 1
            if queue_index >= len(queue):
                if loop:
                    print("[LOOP] Restarting queue from the beginning.")
                    queue_index = 0
                else:
                    print("[DONE] All videos finished.")
                    break

    except (WebSocketDisconnect, ConnectionClosed):
        print("Client disconnected from the stream.")
    finally:
        control_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await control_task


ASCII_LOGO = "\033[36m" + r"""
    _    ____   ____ ___ _     ___ _   _ _____ 
   / \  / ___| / ___|_ _| |   |_ _| \ | | ____|
  / _ \ \___ \| |    | || |    | ||  \| |  _|  
 / ___ \ ___) | |___ | || |___ | || |\  | |___ 
/_/   \_\____/ \____|___|_____|___|_| \_|_____|
""" + "\033[0m"

HELP_TEXT = "\033[1;37m" + """
╔═══════════════════════════════════════════════════╗
║               ASCILINE  —  COMMANDS               ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║  \033[36m/help\033[1;37m      Show this help message               ║
║  \033[36m/status\033[1;37m    Show current server & playback info  ║
║  \033[36m/quit\033[1;37m      Stop the server and exit             ║
║                                                   ║
╠═══════════════════════════════════════════════════╣
║             CLI LAUNCH OPTIONS                    ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║  \033[33m─── Source ───\033[1;37m                                  ║
║  \033[32mvideo\033[1;37m          Path to a single video file      ║
║  \033[32m--playlist\033[1;37m     JSON playlist file               ║
║  \033[32m--folder\033[1;37m       Play all videos in a folder      ║
║                                                   ║
║  \033[33m─── Render ───\033[1;37m                                  ║
║  \033[32m--mode\033[1;37m  \033[35m1-5\033[1;37m    Color quality                    ║
║     1=B&W  2=512c  3=32Kc  4=262Kc  5=16M        ║
║  \033[32m--pixel\033[1;37m        Pixel block mode (with mode 2-5) ║
║  \033[32m--cols\033[1;37m  \033[35mN\033[1;37m      Grid columns  (default: 200)     ║
║  \033[32m--rows\033[1;37m  \033[35mN\033[1;37m      Grid rows     (default: auto)    ║
║                                                   ║
║  \033[33m─── Playback ───\033[1;37m                                ║
║  \033[32m--vol\033[1;37m   \033[35m0-5\033[1;37m    Volume (0=mute, 1=normal, 5=2x)  ║
║  \033[32m--loop\033[1;37m         Loop the playlist infinitely     ║
║  \033[32m--quality\033[1;37m \033[35mlvl\033[1;37m  Codec quality (lossless,low,etc) ║
║                                                   ║
║  \033[33m─── Server ───\033[1;37m                                  ║
║  \033[32m--port\033[1;37m  \033[35mN\033[1;37m      Server port    (default: 8000)    ║
║  \033[32m--debug\033[1;37m        Show bandwidth stats (RAW/WIRE)  ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
""" + "\033[0m"


def print_status():
    """Prints current server status."""
    queue = getattr(app.state, "queue", [])
    idx   = getattr(app.state, "current_index", 0)
    loop  = getattr(app.state, "loop", False)
    cols  = getattr(app.state, "cols", 0)
    rows  = getattr(app.state, "rows", 0)

    print(f"\n\033[1;37m{'═'*55}\033[0m")
    print(f" \033[32m▶\033[0m \033[1mQueue\033[0m      : {len(queue)} video(s)")
    print(f" \033[32m▶\033[0m \033[1mNow Playing\033[0m: {idx + 1}/{len(queue)}")
    if queue and idx < len(queue):
        entry = queue[idx]
        px = ' \033[35m[PIXEL]\033[0m' if entry.get('pixel') else ''
        cols = entry.get('cols', cols)
        rows = entry.get('rows', rows)
        print(f" \033[32m▶\033[0m \033[1mVideo\033[0m      : \033[36m{entry['video']}\033[0m")
        print(f" \033[32m▶\033[0m \033[1mSettings\033[0m   : mode={entry['mode']}{px} vol={entry['vol']}")
    res_str = f"{cols}x{rows}" if rows > 0 else f"{cols}x(auto)"
    print(f" \033[32m▶\033[0m \033[1mResolution\033[0m : {res_str}")
    print(f" \033[32m▶\033[0m \033[1mLoop\033[0m       : {'ON' if loop else 'OFF'}")
    print(f"\033[1;37m{'═'*55}\033[0m\n")


def command_loop():
    """Interactive command listener — runs in main thread alongside uvicorn."""
    print(f" \033[90mType \033[36m/help\033[90m for available commands.\033[0m\n")
    while True:
        try:
            cmd = input().strip().lower()
            if cmd in ('/help', 'help'):
                print(HELP_TEXT)
            elif cmd in ('/status', 'status'):
                print_status()
            elif cmd in ('/quit', 'quit', 'exit'):
                print("\n \033[33m⏹  Shutting down ASCILINE...\033[0m\n")
                os._exit(0)
            elif cmd:
                print(f" \033[90mUnknown command: '{cmd}'. Type \033[36m/help\033[90m for options.\033[0m")
        except (EOFError, KeyboardInterrupt):
            print("\n \033[33m⏹  Shutting down ASCILINE...\033[0m\n")
            os._exit(0)


if __name__ == "__main__":
    import argparse
    import os
    import threading
    
    # Enable ANSI escape sequences on Windows
    os.system("")

    parser = argparse.ArgumentParser(
        description=f"{ASCII_LOGO}\nReal-Time ASCII Web Server\n"
                    "Stream local videos to your browser with high performance ASCII and Pixel rendering.",
        formatter_class=argparse.RawTextHelpFormatter
    )

    # ── Source ──
    src = parser.add_argument_group('\033[33mSource\033[0m')
    src.add_argument(
        "video",
        nargs="?",
        default="video.mp4",
        help="Single video file to stream"
    )
    src.add_argument(
        "--playlist",
        metavar="FILE",
        default=None,
        help="Path to a playlist JSON file\n"
             "  Format: [{\"video\": \"a.mp4\", \"mode\": 5, \"vol\": 3}, ...]"
    )
    src.add_argument(
        "--folder",
        metavar="DIR",
        default=None,
        help="Path to a folder; plays all videos in filesystem order"
    )

    # ── Render ──
    render = parser.add_argument_group('\033[33mRender\033[0m')
    render.add_argument(
        "--mode",
        type=int, choices=[1, 2, 3, 4, 5], default=1,
        help="Color quality: 1=B&W  2=512c  3=32Kc  4=262Kc  5=16M Ultra"
    )
    render.add_argument(
        "--pixel",
        action="store_true", default=False,
        help="Pixel mode: replaces ASCII characters with colored blocks (combine with --mode 2-5)"
    )
    render.add_argument("--cols", type=int, default=None, help="Grid columns (default: 200 for text, 450 for pixel)")
    render.add_argument("--rows", type=int, default=0,   help="Grid rows    (default: auto from video aspect ratio)")

    # ── Playback ──
    playback = parser.add_argument_group('\033[33mPlayback\033[0m')
    playback.add_argument(
        "--vol",
        type=int, default=1,
        help="Volume 0-5  (0=muted, 1=normal, 5=double)"
    )
    playback.add_argument("--loop", action="store_true", default=False, help="Loop the queue infinitely")
    playback.add_argument(
        "--quality",
        choices=["lossless", "high", "balanced", "low"], default="lossless",
        help="Adaptive-codec colour fidelity (lossless = bit-exact; lower = "
             "smaller stream via lossy temporal delta). Chars always exact."
    )

    # ── Server ──
    srv = parser.add_argument_group('\033[33mServer\033[0m')
    srv.add_argument("--host", default="127.0.0.1", help="Bind address (default 127.0.0.1; use 0.0.0.0 to expose on LAN)")
    srv.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    srv.add_argument("--debug", action="store_true", default=False, help="Enable bandwidth debug logging (RAW vs WIRE)")

    args = parser.parse_args()

    # Validate: --pixel requires color mode (2-5)
    if args.pixel and args.mode == 1:
        print("[ERROR] --pixel requires a color mode (--mode 2-5). B&W mode is text-only.")
        exit(1)

    # Build the queue
    queue = build_queue(args)

    if not queue:
        print("[ERROR] No videos found. Check your --playlist / --folder / video argument.")
        exit(1)

    # Save state
    app.state.queue         = queue
    app.state.current_index = 0
    app.state.loop          = args.loop
    app.state.tolerance     = {"lossless": 0, "high": 4, "balanced": 8, "low": 16}[args.quality]
    app.state.debug         = args.debug
    global_default_cols     = args.cols if args.cols is not None else (450 if args.pixel else 200)
    app.state.cols          = global_default_cols
    app.state.rows          = args.rows

    # ── High FPS Warning ──
    high_fps_videos = []
    for entry in queue:
        cap = cv2.VideoCapture(entry['video'])
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps > 35:  # Consider > 35 as high FPS
                high_fps_videos.append((entry['video'], fps))
        cap.release()

    if high_fps_videos:
        print("\n\033[1;33m[WARNING] High FPS Source(s) Detected:\033[0m")
        for vid, fps in high_fps_videos:
            print(f"  - \033[36m{vid}\033[0m is \033[1;31m{fps:.1f} FPS\033[0m")
        print("\033[33mASCILINE is optimized for 24-30 FPS cinematic playback.")
        print("High FPS videos will automatically be decimated to ~30 FPS,")
        print("but performance may still drop depending on the system's CPU.")
        print("For optimal performance, we recommend using 30 FPS source videos.\033[0m\n")
        
        while True:
            choice = input("\033[1mDo you want to continue anyway? (y/n): \033[0m").strip().lower()
            if choice == 'y':
                break
            elif choice == 'n':
                print("Exiting...")
                exit(0)

    # ── Startup Banner ──
    print(ASCII_LOGO)
    print(f"\033[1;37m{'═'*55}\033[0m")
    print(f" \033[32m▶\033[0m \033[1mQueue\033[0m     : {len(queue)} video(s)")
    print(f" \033[32m▶\033[0m \033[1mLoop\033[0m      : {'ON' if args.loop else 'OFF'}")
    res_str = f"{global_default_cols}x{args.rows}" if args.rows > 0 else f"{global_default_cols}x(auto)"
    print(f" \033[32m▶\033[0m \033[1mResolution\033[0m: {res_str}")
    print(f" \033[32m▶\033[0m \033[1mDefault\033[0m   : mode={args.mode} | pixel={'ON' if args.pixel else 'OFF'} | vol={args.vol}")
    print(f"\033[1;37m{'─'*55}\033[0m")
    for i, entry in enumerate(queue, 1):
        px = ' \033[35m[PIXEL]\033[0m' if entry.get('pixel') else ''
        print(f"  {i:2}. \033[36m{entry['video']}\033[0m  (mode={entry['mode']}{px} vol={entry['vol']})")
    print(f"\033[1;37m{'═'*55}\033[0m\n")
    print(f" \033[1;32m🚀 Server live →\033[0m \033[4;36mhttp://localhost:{args.port}\033[0m\n")

    # ── Run server in background thread, command loop in main thread ──
    server_thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={
            "host": args.host,
            "port": args.port,
            "log_level": "warning",
        },
        daemon=True
    )
    server_thread.start()
    command_loop()
