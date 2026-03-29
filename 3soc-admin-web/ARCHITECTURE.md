# AI Detection Dashboard - Architecture Documentation

## 📐 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Client (React + Next.js)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Main Dashboard (page.tsx)               │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │  │
│  │  │ Detection │ │ History  │  │ Model Monitoring  │   │  │
│  │  │   Tab     │ │   Tab    │  │      Tab          │   │  │
│  │  └────┬─────┘  └─────┬────┘  └────────┬─────────┘   │  │
│  │       │              │               │                │  │
│  │  ┌────▼──────────────▼───────────────▼────┐           │  │
│  │  │    Component State Management           │           │  │
│  │  │ - detectionResults (Map)               │           │  │
│  │  │ - modelStats (State)                   │           │  │
│  │  │ - wsClient (WebSocket)                 │           │  │
│  │  └───────────────┬────────────────────────┘           │  │
│  └────────────────┼────────────────────────────────────┘  │
│                   │                                         │
│              ┌────▼──────┐                                 │
│              │ Components │                                 │
│              └────┬───────┘                                │
│         ┌─────────┼──────────────┐                         │
│         │         │              │                         │
│    ┌────▼────┐ ┌─▼──────────┐ ┌─▼──────────┐             │
│    │ Video   │ │ Canvas     │ │ History    │             │
│    │ Player  │ │ Overlay    │ │ List       │             │
│    └────┬────┘ └────────────┘ └────────────┘             │
│         │                                                  │
└─────────┼──────────────────────────────────────────────┘  │
          │                                                   │
          │ WebSocket Connection                             │
          │ (Binary Frame Data)                              │
          │                                                   │
┌─────────▼───────────────────────────────────────────────┐  │
│          Server (Node.js/Python)                        │  │
│  ┌──────────────────────────────────────────────────┐  │  │
│  │         WebSocket Server (ws/wss)               │  │  │
│  │  ├─ Frame Processing Queue                      │  │  │
│  │  ├─ AI Model Inference Engine                   │  │  │
│  │  └─ System Monitoring                           │  │  │
│  ├──────────────────────────────────────────────────┤  │  │
│  │  REST API                                        │  │  │
│  │  ├─ POST /upload-video                          │  │  │
│  │  ├─ GET /history                                │  │  │
│  │  ├─ GET /history/:id                            │  │  │
│  │  └─ DELETE /history/:id                         │  │  │
│  ├──────────────────────────────────────────────────┤  │  │
│  │  AI Model                                        │  │  │
│  │  └─ TensorFlow/PyTorch/ONNX Runtime             │  │  │
│  └──────────────────────────────────────────────────┘  │  │
└──────────────────────────────────────────────────────┘  │
```

## 🔄 Data Flow Architecture

### 1. Video Upload & Frame Extraction

```
User selects video file
         ↓
[VideoPlayer] validates format (MP4)
         ↓
Creates ObjectURL
         ↓
Loads into <video> element
         ↓
User clicks Play
         ↓
requestAnimationFrame loop starts
         ↓
Every frame (30 FPS):
  ├─ Capture video frame to Canvas
  ├─ Convert to JPEG (base64)
  └─ Send via WebSocket
         ↓
[WebSocketClient.sendFrame()]
         ├─ frameData: base64 string
         ├─ timestamp: ms (video.currentTime)
         └─ videoId: string
```

### 2. Real-time Detection Processing

```
Server receives frame
         ↓
Add to processing queue
         ↓
AI Model Inference (async)
         ↓
Generate bounding boxes
         ↓
Broadcast stats to all clients
         ↓
Send detection result back to client
         ↓
[Client receives detection message]
         ↓
Store in detectionResults Map
  Key: timestamp (ms)
  Value: BoundingBox[]
         ↓
[CanvasOverlay] checks for matching timestamp
         ↓
Draw boxes on canvas overlay
```

### 3. Frame Synchronization

```
Video timestamp (currentTime)
         ↓
Extract frame at t=1000ms
         ↓
Send to server: { timestamp: 1000, ... }
         ↓
Server processes: ~50ms
         ↓
Server responds: { timestamp: 1000, boxes: [...] }
         ↓
Client stores: detectionResults.set(1000, boxes)
         ↓
Video playing, now at t=1050ms
         ↓
CanvasOverlay looks for timestamp within 100ms tolerance
         ↓
Finds t=1000ms data (within 50ms of current time)
         ↓
Draw boxes for this frame
```

## 🧩 Component Interaction Diagram

```
┌─────────────────────┐
│   Main Page.tsx     │
│  (Dashboard State)  │
└────────┬────────────┘
         │
    ┌────┴────────────────────┬─────────────────┐
    │                         │                 │
    ▼                         ▼                 ▼
┌──────────────┐      ┌──────────────┐   ┌──────────────┐
│ VideoPlayer  │      │ HistoryList  │   │ ModelStats   │
│              │      │              │   │              │
│ ├─ Upload    │      │ ├─ Sort      │   │ ├─ GPU Load  │
│ ├─ Play/Pause│      │ ├─ Filter    │   │ ├─ CPU Load  │
│ └─ Extract   │      │ ├─ View      │   │ ├─ Memory    │
│   Frames     │      │ └─ Delete    │   │ └─ Stats     │
└──────┬───────┘      └──────────────┘   └──────────────┘
       │
    ┌──┴──────────────────┐
    │                     │
    ▼                     ▼
┌──────────────┐    ┌─────────────────┐
│ CanvasOverlay│    │ WebSocketClient │
│              │    │                 │
│ ├─ Draw Boxes│    │ ├─ Connect      │
│ ├─ Sync Time │    │ ├─ Send Frames  │
│ └─ Render    │    │ ├─ Receive Data │
│   Boxes      │    │ └─ Reconnect    │
└──────────────┘    └─────────────────┘
```

## 💾 State Management

### Application State Structure

```typescript
{
  // WebSocket Management
  wsClient: WebSocketClient | null,
  isWsConnected: boolean,

  // Detection Results
  detectionResults: Map<
    number,           // timestamp (ms)
    BoundingBox[]     // array of detections
  >,

  // Server Statistics
  modelStats: {
    fps: number,
    gpuLoad: number,
    cpuLoad: number,
    memoryUsage: number,
    memoryTotal: number,
    queueLength: number,
    isOnline: boolean,
    lastUpdate: Date
  },

  // UI State
  currentTab: 'detection' | 'history' | 'monitoring',
  isProcessing: boolean,

  // History Data
  historyItems: HistoryItem[]
}
```

### Frame Data Structure

```typescript
// Sent to Server
{
  type: 'frame',
  frameData: string,      // base64 JPEG
  timestamp: number,      // video.currentTime * 1000 (ms)
  videoId: string
}

// Received from Server
{
  type: 'detection',
  timestamp: number,
  boxes: [
    {
      x: number,
      y: number,
      width: number,
      height: number,
      label: string,
      confidence: number     // 0-1
    }
  ]
}
```

## 🎬 Component Lifecycle

### VideoPlayer Component

```
MOUNT
  ├─ Initialize video ref
  ├─ Set isPlaying = false
  ├─ Load last saved video if exists
  └─ Attach video event listeners

USER ACTION: Select video
  ├─ Create ObjectURL from file
  ├─ Set video.src
  └─ Reset timestamp

USER ACTION: Click Play
  ├─ video.play()
  ├─ Start requestAnimationFrame loop
  └─ Extract frames at 30 FPS

FRAME EXTRACTION (per frame)
  ├─ Get video dimensions
  ├─ Create canvas
  ├─ ctx.drawImage(video, 0, 0)
  ├─ Convert to base64 JPEG
  └─ Call onFrameExtracted callback

USER ACTION: Click Pause
  ├─ video.pause()
  └─ Cancel requestAnimationFrame

UNMOUNT
  ├─ Stop animation frame
  ├─ Remove event listeners
  └─ Revoke ObjectURL
```

### CanvasOverlay Component

```
MOUNT
  ├─ Get canvas ref
  ├─ Calculate dimensions
  ├─ Start animation frame loop
  └─ Attach resize listener

ANIMATION FRAME (continuous)
  ├─ Get current video timestamp
  ├─ Search detectionTimestamps map
  ├─ Find boxes within 100ms tolerance
  ├─ Clear canvas
  ├─ Draw boxes + labels
  └─ Request next frame

VIDEO RESIZE
  ├─ Get video dimensions
  ├─ Update canvas.width
  ├─ Update canvas.height
  └─ Trigger redraw

UNMOUNT
  ├─ Cancel animation frame
  ├─ Remove resize listener
  └─ Clear canvas
```

## 🌐 WebSocket Communication Protocol

### Connection Flow

```
CLIENT                              SERVER
  │                                   │
  ├─ WebSocket('/realtime') ─────────→│
  │                                   │
  │                    ← {'type': 'connected', 'clientId': 'uuid'}
  │
  ├─ {'type': 'frame', ...} ─────────→│
  │                                   │ (Process in queue)
  │                    ← {'type': 'detection', ...}
  │
  ├─ {'type': 'frame', ...} ─────────→│
  │                                   │
  │                    ← {'type': 'stats', ...}
  │
  │ (Connection lost)
  │                                   │
  ├─ Auto-reconnect (delay 3s) ──────→│
```

### Message Types

| Type | Direction | Purpose | Payload |
|------|-----------|---------|---------|
| `connected` | S→C | Connection established | clientId, message |
| `frame` | C→S | Video frame for analysis | frameData, timestamp, videoId |
| `detection` | S→C | Detection results | timestamp, boxes |
| `stats` | S→C | Server performance metrics | fps, gpuLoad, cpuLoad, memory, queue |
| `ping` | C→S | Connection keep-alive | - |
| `pong` | S→C | Keep-alive response | timestamp |
| `error` | S→C | Error notification | message |

## 📊 Performance Considerations

### Frame Rate Management

```
Video FPS: Depends on video (typically 24-60 fps)
Capture Rate: Fixed 30 FPS (33ms interval)
Processing Latency: ~50-200ms per frame
Network Latency: ~20-100ms round-trip
Total End-to-End: ~100-400ms

Result: Slight latency acceptable for monitoring dashboard
```

### Memory Optimization

```
Frame Size:
  - 1280x720 video
  - Canvas capture: ~2.9MB (raw)
  - JPEG compression: ~50-100KB per frame
  
Storage:
  - detectionResults Map stores only timestamps + boxes
  - 30 frames/sec * 60 seconds = 1800 detections
  - Average box size: ~300 bytes
  - Total: ~500KB per minute (manageable)
```

### Canvas Rendering Optimization

```
Technique: RequestAnimationFrame
├─ Browser handles V-sync timing
├─ Skips frames if behind (no redundant renders)
└─ Syncs with display refresh rate

Optimization:
├─ Only redraw if new detection data available
├─ Clear canvas once per frame (batch clear)
├─ Use canvas context state efficiently
└─ Avoid memory leaks from forgotten refs
```

## 🔌 Integration Points

### With Backend AI Service

```
Requirements:
├─ Process frames in <100ms for real-time feel
├─ Handle queue backlog gracefully
├─ Provide system stats (GPU, CPU, memory)
└─ Support concurrent client connections

Scaling Strategies:
├─ Frame batching (process 5 frames together)
├─ Worker threads for parallelization
├─ GPU acceleration (CUDA, OpenCL)
├─ Model quantization (int8 inference)
└─ Distributed processing (multiple servers)
```

### With Frontend Analytics

```
Data to Track:
├─ Frame processing latency
├─ Detection accuracy metrics
├─ Queue depth over time
├─ System resource usage
└─ Client connection duration

Implementation:
├─ Send telemetry events via WebSocket
├─ Log to central analytics service
├─ Dashboard for historical trends
└─ Alerts for degradation
```

## 🛡️ Error Handling Strategy

```
Frame Extraction Failure
├─ Log error in console
├─ Skip frame (continue with next)
└─ No UI interruption

WebSocket Connection Lost
├─ Set isWsConnected = false
├─ Show disconnection warning
├─ Auto-reconnect with exponential backoff
└─ Resume when connection restored

Detection Timeout
├─ Queue exceeded max length
├─ Remove oldest frame from queue
├─ Alert user of latency
└─ Continue processing

Canvas Rendering Error
├─ Catch in animation loop
├─ Log error
├─ Continue running (don't crash)
└─ User sees empty overlay
```

## 📈 Scalability Architecture

```
Single Server:
  └─ 1 server handles ~50-100 concurrent clients
     (depends on frame rate & model complexity)

Multiple Servers:
  ├─ Load balancer distributes connections
  ├─ Each server processes independently
  └─ Stats aggregated on client

Database Storage:
  ├─ Store detection results in SQL DB
  ├─ Cache recent results in Redis
  └─ Archive old results to object storage

Message Queue:
  ├─ Use Kafka/RabbitMQ for frame processing
  ├─ Decouple ingestion from processing
  └─ Enable horizontal scaling
```

## 🔄 Deployment Architecture

```
Development:
  ├─ React Vite dev server (port 3000)
  └─ Node.js server (port 8000)

Production:
  ├─ Vercel (Frontend)
  ├─ AWS ECS (Backend)
  ├─ RDS (Database)
  ├─ CloudFront (CDN)
  └─ WAF (Security)

Docker:
  ├─ Client: Node.js + Next.js build
  └─ Server: Python FastAPI + GPU support
```

This architecture supports real-time video processing with scalability and reliability for production use cases.
