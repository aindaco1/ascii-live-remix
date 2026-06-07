# ASCILINE Architecture Notes
*A turning point in performance and synchronization.*

## The Philosophy
As the creator of ASCILINE, I believe in taking calculated, deliberate steps to ensure every component of this engine is fundamentally solid before moving forward. This document records the most critical architectural turning point in the project's history: **The transition from a naive frame loop to a professional-grade, self-healing media engine.**

## 1. The Audio Master Clock (A/V Sync)
**The Problem:** Originally, video frames and audio were streaming independently. If the computer lagged, the video slowed down, but the audio kept playing. This caused irreversible desynchronization.
**The Turning Point:** We shifted the paradigm. The Audio is now the absolute "Master Clock". 
- The server mathematically calculates the exact timestamp each frame belongs to.
- The browser checks the audio track's current time. 
- If the video is lagging, the system instantly drops frames to catch up. 
- If the video is ahead, it pauses and waits for the audio.
**Result:** The stream is perfectly self-correcting. Even if you minimize the browser or experience a heavy CPU spike, the video will flawlessly snap back into sync with the audio the moment performance returns.

## 2. Zero-Copy Pipeline (The Direct Canvas Transfer)
**The Problem:** In our early pixel-mode implementation, Python was doing too much "heavy lifting". It was receiving BGR data from the video, copying it to flip it to RGB, appending invisible ASCII characters to every pixel, and packing it into a massive array before sending it. 
**The Turning Point:** We eliminated the middleman.
- **Is the stream directly transferring to the web canvas now?** **YES.**
- In Pixel Mode (`--pixel`), Python takes the raw, untouched BGR byte array directly from the OpenCV video decoder and shoots it straight down the WebSocket.
- There is no memory copying, no array flipping, and no invisible characters. 
- On the receiving end, the JavaScript V8 engine takes those raw bytes and maps them directly into the HTML5 Canvas `ImageData` memory buffer.

**Result:** CPU usage plummeted. The WebSocket payload size decreased by 25%. We achieved what is essentially a "Zero-Copy" direct pipeline from the video file on the server straight to the pixels on the browser screen, unlocking pure 60 FPS performance without breaking a sweat.

## 3. Future Vision: Production Broadcaster Architecture (Rust / C++)
**Current Limitation:** The Python prototype operates on a "Video-on-Demand" architecture. Each new user triggers a separate OpenCV video decoding pipeline. Python's single-core GIL architecture caps out around 3-4 users before the server freezes.
**The Planned Evolution:** If ASCILINE is deployed as a massive public website, the backend will be rewritten from scratch in **Rust** or **C++**.
- **Standardized Performance:** The engine will standardize on 30 FPS for perfect stability.
- **True Broadcasting (Copy Cycles):** The server will decode the video exactly *once* in the background. The resulting byte array will be instantly duplicated (broadcasted) to thousands of connected WebSockets simultaneously.
- **Load-Shedding & Auto-Shutdown:** Built-in safeguards will actively monitor concurrent connections. If a massive traffic spike (e.g., 5,000+ users) overwhelms network bandwidth or RAM, the engine will intelligently shed load or gracefully shut down the broadcast to prevent a hard server crash.
- **Result:** A truly commercial-grade, real-time media server capable of handling thousands of concurrent viewers like a modern Twitch stream, built directly on top of the theoretical foundations proven in this Python prototype.
